export interface QuizResponseModel {
  id: string;
  title: string;
  topic?: string | null;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  questionCount: number;
  status: string;
  sourceDocumentId?: string | null;
  createdAt: string;
}

export interface QuizQuestionResponseModel {
  id: string;
  orderIndex: number;
  prompt: string;
  options: string[];
  correctAnswer?: string; // Omitted in active attempts
  explanation?: string | null;
}

export interface QuizAttemptResponseModel {
  id: string;
  quizId: string;
  status: "IN_PROGRESS" | "SUBMITTED" | "ABANDONED";
  score: number | null;
  totalQuestions: number;
  startedAt: string;
  submittedAt: string | null;
  questions: QuizQuestionResponseModel[];
}

export interface QuestionReviewItemModel {
  questionId: string;
  prompt: string;
  selectedAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  explanation?: string | null;
}

export interface QuizSubmissionResultModel {
  attemptId: string;
  score: number;
  totalQuestions: number;
  review: QuestionReviewItemModel[];
}

export interface GeneratedQuizQuestion {
  orderIndex: number;
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}
