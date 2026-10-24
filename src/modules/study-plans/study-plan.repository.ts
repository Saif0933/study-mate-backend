import { prisma } from "../../config/prisma";
import { Prisma, StudyPlan, StudyTask } from "../../generated/prisma/client";
import { StudyPlanStatus, StudyTaskStatus, AIRequestFeature, AIRequestStatus } from "../../generated/prisma/enums";
import { calculateEstimatedCost } from "../../utils/cost-calculator";

export interface CreatePlanWithTasksData {
  id?: string;
  userId: string;
  title: string;
  examDate?: Date | null;
  timezone: string;
  dailyMinutes: number;
  preferences?: Record<string, unknown> | null;
  status?: StudyPlanStatus;
  tasks: Array<{
    id?: string;
    title: string;
    description?: string | null;
    topic?: string | null;
    scheduledDate: Date;
    durationMinutes: number;
    status?: StudyTaskStatus;
    orderIndex?: number;
  }>;
}

export interface TaskInsertData {
  id?: string;
  planId: string;
  title: string;
  description?: string | null;
  topic?: string | null;
  scheduledDate: Date;
  durationMinutes: number;
  status?: StudyTaskStatus;
  orderIndex?: number;
}

export interface RecordStudyPlanUsageData {
  userId: string;
  requestId: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  status: AIRequestStatus;
  errorCode?: string;
}

export type StudyPlanWithTasks = StudyPlan & {
  tasks: StudyTask[];
};

export type StudyTaskWithPlan = StudyTask & {
  plan: StudyPlan;
};

export class StudyPlanRepository {
  /**
   * Creates a study plan and initial tasks within a single atomic database transaction.
   */
  async createPlanWithTasks(data: CreatePlanWithTasksData): Promise<StudyPlanWithTasks> {
    return prisma.$transaction(async (tx) => {
      const plan = await tx.studyPlan.create({
        data: {
          id: data.id,
          userId: data.userId,
          title: data.title,
          examDate: data.examDate,
          timezone: data.timezone,
          dailyMinutes: data.dailyMinutes,
          preferences: data.preferences ? (data.preferences as Prisma.InputJsonValue) : Prisma.DbNull,
          status: data.status || StudyPlanStatus.ACTIVE,
        },
      });

      if (data.tasks.length > 0) {
        await tx.studyTask.createMany({
          data: data.tasks.map((t, idx) => ({
            id: t.id,
            planId: plan.id,
            title: t.title,
            description: t.description || null,
            topic: t.topic || null,
            scheduledDate: t.scheduledDate,
            durationMinutes: t.durationMinutes,
            status: t.status || StudyTaskStatus.TODO,
            orderIndex: t.orderIndex ?? idx,
          })),
        });
      }

      const tasks = await tx.studyTask.findMany({
        where: { planId: plan.id },
        orderBy: [{ scheduledDate: "asc" }, { orderIndex: "asc" }],
      });

      return {
        ...plan,
        tasks,
      };
    });
  }

  /**
   * Finds a study plan by ID with all tasks ordered chronologically.
   */
  async findById(planId: string): Promise<StudyPlanWithTasks | null> {
    return prisma.studyPlan.findUnique({
      where: { id: planId },
      include: {
        tasks: {
          orderBy: [{ scheduledDate: "asc" }, { orderIndex: "asc" }],
        },
      },
    });
  }

  /**
   * Finds all non-deleted plans for a user ordered by updatedAt descending.
   */
  async findByUserId(userId: string): Promise<StudyPlanWithTasks[]> {
    return prisma.studyPlan.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      include: {
        tasks: {
          orderBy: [{ scheduledDate: "asc" }, { orderIndex: "asc" }],
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * Updates plan metadata (title, status, preferences).
   */
  async updatePlan(
    planId: string,
    data: {
      title?: string;
      status?: StudyPlanStatus;
      preferences?: Record<string, unknown> | null;
      dailyMinutes?: number;
      examDate?: Date | null;
    }
  ): Promise<StudyPlanWithTasks> {
    return prisma.studyPlan.update({
      where: { id: planId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.preferences !== undefined && { preferences: data.preferences === null ? Prisma.DbNull : (data.preferences as Prisma.InputJsonValue) }),
        ...(data.dailyMinutes !== undefined && { dailyMinutes: data.dailyMinutes }),
        ...(data.examDate !== undefined && { examDate: data.examDate }),
      },
      include: {
        tasks: {
          orderBy: [{ scheduledDate: "asc" }, { orderIndex: "asc" }],
        },
      },
    });
  }

  /**
   * Soft deletes a study plan by setting deletedAt.
   */
  async deletePlan(planId: string): Promise<void> {
    await prisma.studyPlan.update({
      where: { id: planId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Atomically regenerates tasks for a plan while preserving completed tasks.
   */
  async regeneratePlanTasks(
    planId: string,
    preserveCompleted: boolean,
    newTasks: Array<{
      id?: string;
      title: string;
      description?: string | null;
      topic?: string | null;
      scheduledDate: Date;
      durationMinutes: number;
      status?: StudyTaskStatus;
      orderIndex?: number;
    }>,
    planUpdates?: {
      dailyMinutes?: number;
      examDate?: Date | null;
    }
  ): Promise<StudyPlanWithTasks> {
    return prisma.$transaction(async (tx) => {
      // 1. Delete previous tasks (preserve completed if flag is true)
      if (preserveCompleted) {
        await tx.studyTask.deleteMany({
          where: {
            planId,
            status: { not: StudyTaskStatus.COMPLETED },
          },
        });
      } else {
        await tx.studyTask.deleteMany({
          where: { planId },
        });
      }

      // 2. Insert newly generated tasks
      if (newTasks.length > 0) {
        await tx.studyTask.createMany({
          data: newTasks.map((t, idx) => ({
            id: t.id,
            planId,
            title: t.title,
            description: t.description || null,
            topic: t.topic || null,
            scheduledDate: t.scheduledDate,
            durationMinutes: t.durationMinutes,
            status: t.status || StudyTaskStatus.TODO,
            orderIndex: t.orderIndex ?? idx,
          })),
        });
      }

      // 3. Update plan parameters if provided
      if (planUpdates) {
        await tx.studyPlan.update({
          where: { id: planId },
          data: {
            ...(planUpdates.dailyMinutes !== undefined && { dailyMinutes: planUpdates.dailyMinutes }),
            ...(planUpdates.examDate !== undefined && { examDate: planUpdates.examDate }),
          },
        });
      }

      return tx.studyPlan.findUniqueOrThrow({
        where: { id: planId },
        include: {
          tasks: {
            orderBy: [{ scheduledDate: "asc" }, { orderIndex: "asc" }],
          },
        },
      });
    });
  }

  /**
   * Finds a task by ID including parent plan for authorization checking.
   */
  async findTaskById(taskId: string): Promise<StudyTaskWithPlan | null> {
    return prisma.studyTask.findUnique({
      where: { id: taskId },
      include: { plan: true },
    });
  }

  /**
   * Updates task details or status.
   */
  async updateTask(
    taskId: string,
    data: {
      status?: StudyTaskStatus;
      completedAt?: Date | null;
      title?: string;
      topic?: string | null;
      description?: string | null;
      durationMinutes?: number;
      scheduledDate?: Date;
    }
  ): Promise<StudyTask> {
    return prisma.studyTask.update({
      where: { id: taskId },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.topic !== undefined && { topic: data.topic }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.durationMinutes !== undefined && { durationMinutes: data.durationMinutes }),
        ...(data.scheduledDate !== undefined && { scheduledDate: data.scheduledDate }),
      },
    });
  }

  /**
   * Creates a custom task inside a plan.
   */
  async createTask(data: TaskInsertData): Promise<StudyTask> {
    return prisma.studyTask.create({
      data: {
        id: data.id,
        planId: data.planId,
        title: data.title,
        description: data.description || null,
        topic: data.topic || null,
        scheduledDate: data.scheduledDate,
        durationMinutes: data.durationMinutes,
        status: data.status || StudyTaskStatus.TODO,
        orderIndex: data.orderIndex ?? 0,
      },
    });
  }

  /**
   * Deletes a study task.
   */
  async deleteTask(taskId: string): Promise<void> {
    await prisma.studyTask.delete({
      where: { id: taskId },
    });
  }

  /**
   * Records AI Usage entry for Study Plan Generation requests.
   */
  async recordUsage(data: RecordStudyPlanUsageData): Promise<void> {
    await prisma.aIUsage.create({
      data: {
        userId: data.userId,
        requestId: data.requestId,
        feature: AIRequestFeature.STUDY_PLAN_GENERATION,
        provider: "openai",
        modelId: data.modelId,
        status: data.status,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        latencyMs: data.latencyMs,
        estimatedCost: calculateEstimatedCost(data.modelId, data.inputTokens, data.outputTokens),
        errorCode: data.errorCode,
      },
    });
  }
}

export const studyPlanRepository = new StudyPlanRepository();
