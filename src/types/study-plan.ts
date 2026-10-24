export interface StudyTaskResponse {
  id: string;
  planId: string;
  title: string;
  description?: string | null;
  topic?: string | null;
  scheduledDate: string; // ISO string
  durationMinutes: number;
  status: "TODO" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
  orderIndex: number;
  completedAt?: string | null;
}

export interface StudyPlanResponse {
  id: string;
  title: string;
  examDate?: string | null;
  dailyMinutes: number;
  timezone: string;
  preferences?: Record<string, unknown> | null;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  createdAt: string;
  updatedAt?: string | null;
  tasks?: StudyTaskResponse[];
}

export interface GeneratedStudyTaskDraft {
  dayOffset: number; // 0 = day 1, 1 = day 2, etc.
  title: string;
  topic?: string;
  description?: string;
  durationMinutes: number;
}
