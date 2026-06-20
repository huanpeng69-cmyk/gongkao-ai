// ==================== 题型定义 ====================
export type QuestionType = 'single_choice' | 'multi_choice' | 'true_false';

export type ModuleKey =
  | 'smart' | 'yanyu' | 'panduan' | 'ziliao'
  | 'shuliang' | 'changshi' | 'ggjc';

export interface Option {
  key: string;
  text: string;
}

export interface ScoreRule {
  full: number;
  partial: number;
  wrong: number;
}

export interface Question {
  id: string;
  type: QuestionType;
  module: string;
  moduleKey: ModuleKey;
  subModule: string;
  difficulty: number;
  question: string;
  dataMaterial?: string;
  formula?: string;
  options?: Option[];
  answer: string | string[] | boolean;
  partialScore?: boolean;
  scoreRule?: ScoreRule;
  explanation: string;
  knowledgePoints: string[];
  source: string;
  year?: number;
}

// ==================== 用户数据 ====================
export interface ErrorEntry {
  questionId: string;
  question: Question;
  userAnswer: string | string[] | boolean;
  errorType: ErrorType;
  errorDate: string;
  loopStatus: 'pending' | 'reviewing' | 'mastered';
  loopCount: number;
  reviewHistory: ReviewRecord[];
  // 遗忘曲线字段
  nextReviewDate?: string;  // 下次复习日期
  easeFactor?: number;       // 简易因子 (SM-2)
  interval?: number;         // 复习间隔天数
}

export interface ReviewRecord {
  date: string;
  correct: boolean;
  rating?: ReviewRating;
}

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export type ErrorType =
  | '知识盲区' | '概念混淆' | '审题失误'
  | '计算/推理错误' | '思路偏差' | '时间压力';

export interface KnowledgeProfile {
  [key: string]: {
    correct: number;
    total: number;
    level: '优秀' | '中等' | '薄弱' | '严重薄弱';
  };
}

export interface UserProfile {
  name: string;
  streak: number;
  totalQuestions: number;
  totalCorrect: number;
  dailyGoal: number;
  todayDone: number;
  todayCorrect: number;
  errorBook: ErrorEntry[];
  knowledgeProfile: KnowledgeProfile;
}

// ==================== Phase 3 新增 ====================

/** 每日学习记录 */
export interface DailyRecord {
  date: string;       // YYYY-MM-DD
  totalDone: number;
  totalCorrect: number;
  moduleBreakdown: Record<string, { done: number; correct: number }>;
  errorTypes: Record<string, number>;  // 错因分布
  timeSpentMinutes: number;
  reviewDone: number;
  reviewCorrect: number;
}

/** 学习时段记录 */
export interface StudySession {
  date: string;
  startTime: string;
  endTime?: string;
  questionsDone: number;
  mode: 'quiz' | 'review' | 'knowledge';
}

/** 应用完整数据结构 */
export interface AppData {
  user: UserProfile;
  errors: ErrorEntry[];
  answeredIds: string[];
  dailyHistory: DailyRecord[];
  studySessions: StudySession[];
}

// ==================== 模块配置 ====================
export interface ModuleConfig {
  key: ModuleKey;
  name: string;
  icon: string;
  description: string;
  subModules: string[];
  hasFormula?: boolean;
  hasChart?: boolean;
  questionTypes: QuestionType[];
}

export const MODULES: ModuleConfig[] = [
  {
    key: 'smart', name: 'AI智能推荐', icon: 'AI',
    description: '根据你的薄弱知识点智能出题',
    subModules: [], questionTypes: ['single_choice'],
  },
  {
    key: 'yanyu', name: '言语理解与表达', icon: '言',
    description: '逻辑填空 / 片段阅读 / 语句排序',
    subModules: ['逻辑填空', '片段阅读', '语句排序', '主旨概括', '细节判断', '意图推断'],
    questionTypes: ['single_choice'],
  },
  {
    key: 'panduan', name: '判断推理', icon: '判',
    description: '图形推理 / 定义判断 / 类比推理 / 逻辑判断',
    subModules: ['图形推理', '定义判断', '类比推理', '逻辑判断', '削弱论证', '加强论证', '前提假设'],
    questionTypes: ['single_choice'],
  },
  {
    key: 'ziliao', name: '资料分析', icon: '资',
    description: '增长率 / 比重 / 倍数 / 平均数',
    subModules: ['增长率', '增长量', '比重', '平均数', '倍数', '综合分析'],
    hasChart: true, questionTypes: ['single_choice'],
  },
  {
    key: 'shuliang', name: '数量关系', icon: '数',
    description: '工程问题 / 行程问题 / 排列组合',
    subModules: ['工程问题', '行程问题', '排列组合', '经济利润', '容斥问题', '年龄问题', '数字推理'],
    hasFormula: true, questionTypes: ['single_choice'],
  },
  {
    key: 'changshi', name: '常识判断', icon: '常',
    description: '时政 / 法律 / 人文 / 科技 / 地理',
    subModules: ['时政热点', '法律常识', '人文历史', '科技常识', '地理环境', '经济常识'],
    questionTypes: ['single_choice'],
  },
  {
    key: 'ggjc', name: '公共基础知识', icon: '基',
    description: '马哲 / 毛中特 / 法律 / 公文 / 经济',
    subModules: ['马克思主义哲学', '毛泽东思想/中特', '法律基础', '公文写作与处理', '经济常识', '管理常识', '人文科技', '时事政治'],
    questionTypes: ['multi_choice', 'true_false', 'single_choice'],
  },
];

// ==================== 错因分类 ====================
export const ERROR_TYPES: { type: ErrorType; icon: string; color: string }[] = [
  { type: '知识盲区', icon: '知', color: 'var(--link-blue)' },
  { type: '概念混淆', icon: '概', color: 'var(--brand-orange)' },
  { type: '审题失误', icon: '审', color: 'var(--tint-yellow-bold)' },
  { type: '计算/推理错误', icon: '算', color: 'var(--brand-green)' },
  { type: '思路偏差', icon: '路', color: 'var(--link-blue)' },
  { type: '时间压力', icon: '时', color: 'var(--brand-teal)' },
];
