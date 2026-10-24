import { v4 as uuidv4 } from "uuid";
import { StudyPlan, StudyTask } from "../../generated/prisma/client";
import { StudyPlanStatus, StudyTaskStatus, AIRequestStatus } from "../../generated/prisma/enums";
import { studyPlanRepository, StudyPlanRepository } from "./study-plan.repository";
import { studyPlanGraph } from "../../ai/graphs/study-plan.graph";
import { logger } from "../../utils/logger";
import { BadRequestError, NotFoundError, RateLimitError } from "../../utils/errors";
import { StudyPlanResponse, StudyTaskResponse } from "../../types/study-plan";
import {
  CreateStudyPlanInput,
  UpdateStudyPlanInput,
  RegenerateStudyPlanInput,
  UpdateStudyTaskInput,
  CreateStudyTaskInput,
} from "./study-plan.validators";
import { usageService } from "../usage/usage.service";

export class StudyPlanService {
  constructor(private readonly repo: StudyPlanRepository = studyPlanRepository) {}

  /**
   * Sanitizes a StudyTask model for client response.
   */
  sanitizeTask(task: StudyTask): StudyTaskResponse {
    return {
      id: task.id,
      planId: task.planId,
      title: task.title,
      description: task.description,
      topic: task.topic,
      scheduledDate: task.scheduledDate.toISOString(),
      durationMinutes: task.durationMinutes,
      status: task.status as "TODO" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED",
      orderIndex: task.orderIndex,
      completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    };
  }

  /**
   * Sanitizes a StudyPlan model with optional tasks.
   */
  sanitizePlan(plan: StudyPlan, tasks?: StudyTask[]): StudyPlanResponse {
    return {
      id: plan.id,
      title: plan.title,
      examDate: plan.examDate ? plan.examDate.toISOString() : null,
      dailyMinutes: plan.dailyMinutes,
      timezone: plan.timezone,
      preferences: (plan.preferences as Record<string, unknown>) || null,
      status: plan.status as "ACTIVE" | "COMPLETED" | "ARCHIVED",
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt ? plan.updatedAt.toISOString() : null,
      tasks: tasks ? tasks.map((t) => this.sanitizeTask(t)) : [],
    };
  }

  /**
   * Generates a tailored study plan with structured daily tasks.
   */
  async createStudyPlan(
    userId: string,
    input: CreateStudyPlanInput,
    requestId: string
  ): Promise<StudyPlanResponse> {
    // 0. Enforce AI usage quota before invocation
    await usageService.checkQuota(userId);

    // 1. Validate examDate if provided
    let parsedExamDate: Date | null = null;
    let totalDays = 14; // Default 2-week schedule

    if (input.examDate) {
      parsedExamDate = new Date(input.examDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (parsedExamDate.getTime() < today.getTime()) {
        throw new BadRequestError("Exam date cannot be in the past.");
      }

      const daysDiff = Math.ceil((parsedExamDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      // Clamp schedule between 1 and 60 days
      totalDays = Math.min(Math.max(1, daysDiff), 60);
    }

    // 2. Concurrency/duplicate guard: check recent plans with exact same title within 3s
    const existingPlans = await this.repo.findByUserId(userId);
    const recentDuplicate = existingPlans.find(
      (p) =>
        p.title.toLowerCase() === input.title.toLowerCase() &&
        Date.now() - p.createdAt.getTime() < 3000
    );
    if (recentDuplicate) {
      throw new RateLimitError("Duplicate study plan request detected. Please wait a moment.");
    }

    // 3. Invoke LangGraph Study Plan Generator workflow
    const result = await studyPlanGraph.invoke({
      title: input.title,
      subjects: input.subjects,
      dailyMinutes: input.dailyMinutes,
      totalDays,
      examDate: input.examDate,
      preferences: input.preferences,
    });

    if (!result.tasks || result.tasks.length === 0) {
      throw new BadRequestError("Failed to generate study tasks for the given subjects and time budget.");
    }

    // 4. Map task day offsets into calendar dates
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const tasksToInsert = result.tasks.map((draft, idx) => {
      const scheduledDate = new Date(startDate.getTime() + draft.dayOffset * 86400000);
      return {
        id: uuidv4(),
        title: draft.title,
        description: draft.description || null,
        topic: draft.topic || null,
        scheduledDate,
        durationMinutes: draft.durationMinutes,
        status: StudyTaskStatus.TODO,
        orderIndex: idx,
      };
    });

    // 5. Persist plan and tasks transactionally
    const planId = uuidv4();
    const created = await this.repo.createPlanWithTasks({
      id: planId,
      userId,
      title: input.title,
      examDate: parsedExamDate,
      timezone: input.timezone,
      dailyMinutes: input.dailyMinutes,
      preferences: input.preferences || null,
      status: StudyPlanStatus.ACTIVE,
      tasks: tasksToInsert,
    });

    // 6. Record AI Usage
    try {
      await this.repo.recordUsage({
        userId,
        requestId,
        modelId: result.modelId || "gpt-4o",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        status: AIRequestStatus.SUCCESS,
      });
    } catch (usageErr) {
      logger.warn({ err: (usageErr as Error).message }, "Failed to record AI usage for study plan generation");
    }

    logger.info(
      { planId: created.id, userId, taskCount: created.tasks.length },
      "Study plan successfully generated and persisted"
    );

    return this.sanitizePlan(created, created.tasks);
  }

  /**
   * Lists all study plans owned by the user.
   */
  async getStudyPlans(userId: string): Promise<StudyPlanResponse[]> {
    const plans = await this.repo.findByUserId(userId);
    return plans.map((p) => this.sanitizePlan(p, p.tasks));
  }

  /**
   * Retrieves single study plan by ID with tasks, enforcing ownership.
   */
  async getStudyPlanById(userId: string, planId: string): Promise<StudyPlanResponse> {
    const plan = await this.repo.findById(planId);
    if (!plan || plan.userId !== userId || plan.deletedAt) {
      throw new NotFoundError("Study plan not found");
    }
    return this.sanitizePlan(plan, plan.tasks);
  }

  /**
   * Updates study plan metadata.
   */
  async updateStudyPlan(
    userId: string,
    planId: string,
    input: UpdateStudyPlanInput
  ): Promise<StudyPlanResponse> {
    const plan = await this.repo.findById(planId);
    if (!plan || plan.userId !== userId || plan.deletedAt) {
      throw new NotFoundError("Study plan not found");
    }

    const updated = await this.repo.updatePlan(planId, {
      title: input.title,
      status: input.status as StudyPlanStatus | undefined,
      preferences: input.preferences,
    });

    return this.sanitizePlan(updated, updated.tasks);
  }

  /**
   * Soft-deletes a study plan.
   */
  async deleteStudyPlan(userId: string, planId: string): Promise<void> {
    const plan = await this.repo.findById(planId);
    if (!plan || plan.userId !== userId || plan.deletedAt) {
      throw new NotFoundError("Study plan not found");
    }

    await this.repo.deletePlan(planId);
    logger.info({ planId, userId }, "Study plan deleted successfully");
  }

  /**
   * Regenerates a study plan while preserving completed tasks.
   */
  async regenerateStudyPlan(
    userId: string,
    planId: string,
    input: RegenerateStudyPlanInput,
    requestId: string
  ): Promise<StudyPlanResponse> {
    const plan = await this.repo.findById(planId);
    if (!plan || plan.userId !== userId || plan.deletedAt) {
      throw new NotFoundError("Study plan not found");
    }

    // Determine parameters
    const dailyMinutes = input.dailyMinutes || plan.dailyMinutes;
    let parsedExamDate = plan.examDate;
    if (input.examDate) {
      parsedExamDate = new Date(input.examDate);
    }

    let totalDays = 14;
    if (parsedExamDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysDiff = Math.ceil((parsedExamDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      totalDays = Math.min(Math.max(1, daysDiff), 60);
    }

    // Find subjects from existing tasks or preferences
    const existingTopics = Array.from(
      new Set(plan.tasks.map((t) => t.topic).filter((t): t is string => Boolean(t)))
    );
    const subjects = existingTopics.length > 0 ? existingTopics : ["General Studies"];

    // Enforce AI usage quota before invocation
    await usageService.checkQuota(userId);

    // Invoke workflow
    const result = await studyPlanGraph.invoke({
      title: plan.title,
      subjects,
      dailyMinutes,
      totalDays,
      examDate: parsedExamDate ? parsedExamDate.toISOString() : undefined,
      preferences: (plan.preferences as Record<string, unknown>) || undefined,
    });

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const newTasksToInsert = result.tasks.map((draft, idx) => ({
      id: uuidv4(),
      title: draft.title,
      description: draft.description || null,
      topic: draft.topic || null,
      scheduledDate: new Date(startDate.getTime() + draft.dayOffset * 86400000),
      durationMinutes: draft.durationMinutes,
      status: StudyTaskStatus.TODO,
      orderIndex: idx + 100, // Offset order index
    }));

    const updatedPlan = await this.repo.regeneratePlanTasks(
      planId,
      input.preserveCompleted !== false,
      newTasksToInsert,
      {
        dailyMinutes: input.dailyMinutes,
        examDate: parsedExamDate,
      }
    );

    // Record AI Usage
    try {
      await this.repo.recordUsage({
        userId,
        requestId,
        modelId: result.modelId || "gpt-4o",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        status: AIRequestStatus.SUCCESS,
      });
    } catch (usageErr) {
      logger.warn({ err: (usageErr as Error).message }, "Failed to record AI usage for plan regeneration");
    }

    return this.sanitizePlan(updatedPlan, updatedPlan.tasks);
  }

  /**
   * Updates task status or details, enforcing plan ownership.
   */
  async updateTask(
    userId: string,
    taskId: string,
    input: UpdateStudyTaskInput
  ): Promise<StudyTaskResponse> {
    const task = await this.repo.findTaskById(taskId);
    if (!task || task.plan.userId !== userId || task.plan.deletedAt) {
      throw new NotFoundError("Study task not found");
    }

    let completedAt = task.completedAt;
    if (input.status === "COMPLETED") {
      completedAt = input.completedAt ? new Date(input.completedAt) : new Date();
    } else if (input.status !== undefined) {
      completedAt = null;
    }

    const scheduledDate = input.scheduledDate ? new Date(input.scheduledDate) : undefined;

    const updated = await this.repo.updateTask(taskId, {
      status: input.status as StudyTaskStatus | undefined,
      completedAt,
      title: input.title,
      topic: input.topic,
      description: input.description,
      durationMinutes: input.durationMinutes,
      scheduledDate,
    });

    return this.sanitizeTask(updated);
  }

  /**
   * Adds a custom task to a study plan.
   */
  async createTask(
    userId: string,
    planId: string,
    input: CreateStudyTaskInput
  ): Promise<StudyTaskResponse> {
    const plan = await this.repo.findById(planId);
    if (!plan || plan.userId !== userId || plan.deletedAt) {
      throw new NotFoundError("Study plan not found");
    }

    const created = await this.repo.createTask({
      id: uuidv4(),
      planId,
      title: input.title,
      topic: input.topic || null,
      description: input.description || null,
      scheduledDate: new Date(input.scheduledDate),
      durationMinutes: input.durationMinutes,
      status: StudyTaskStatus.TODO,
      orderIndex: plan.tasks.length,
    });

    return this.sanitizeTask(created);
  }

  /**
   * Deletes a study task.
   */
  async deleteTask(userId: string, taskId: string): Promise<void> {
    const task = await this.repo.findTaskById(taskId);
    if (!task || task.plan.userId !== userId || task.plan.deletedAt) {
      throw new NotFoundError("Study task not found");
    }

    await this.repo.deleteTask(taskId);
  }
}

export const studyPlanService = new StudyPlanService();
