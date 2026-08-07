export type Role = 'admin' | 'demo' | 'paid';
export type Difficulty = 'basico' | 'intermedio' | 'avanzado';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  active: boolean;
  expiration_date: string; // date ISO 'YYYY-MM-DD'
  questions_used: number;
  questions_limit: number;
  alert_threshold: number;
  current_session_token: string | null;
  current_session_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudyContentRow {
  id: string;
  title: string;
  markdown: string;
  assigned_to: string;
  created_by: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuizQuestionRow {
  id: string;
  user_id: string;
  content_id: string;
  difficulty: Difficulty;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  user_answer_index: number | null;
  is_correct: boolean | null;
  answered_at: string | null;
  created_at: string;
}

// Formas "seguras para el cliente" (sin password_hash) que devuelven las
// rutas /api/admin/*.
export interface AdminUserSummary {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  expiration_date: string;
  questions_used: number;
  questions_limit: number;
  alert_threshold: number;
  created_at: string;
}

export interface AdminContentSummary {
  id: string;
  title: string;
  assigned_to: string;
  active: boolean;
  created_at: string;
  assigned_user: { email: string } | null;
}

export interface GeneratedQuestion {
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
}
