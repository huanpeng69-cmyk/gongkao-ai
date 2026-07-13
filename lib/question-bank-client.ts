import type { Question } from "./types";

export type QuestionBankResponse<T extends Question = Question> = {
  questions?: T[];
  total?: number;
  error?: string;
};

type QuestionBankFile<T extends Question = Question> = {
  meta?: unknown;
  questions?: T[];
};

const publicBasePath = process.env.NEXT_PUBLIC_GONGKAO_BASE_PATH || "";

export async function loadQuestionBank<T extends Question = Question>(limit = 10000): Promise<QuestionBankResponse<T>> {
  try {
    const res = await fetch(`${publicBasePath}/mobile-data/gkzhenti_questions.min.json`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as QuestionBankFile<T>;
      const questions = (data.questions || []).slice(0, limit);
      return { questions, total: data.questions?.length || questions.length };
    }
  } catch {
    // Static mobile asset is optional in desktop development.
  }

  try {
    const res = await fetch(`${publicBasePath}/api/gkzhenti?limit=${limit}`);
    const data = (await res.json()) as QuestionBankResponse<T>;
    return data;
  } catch {
    return { questions: [], total: 0, error: "真题库读取失败" };
  }
}
