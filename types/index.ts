// ─── Telegram ────────────────────────────────────────────────────────────────

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramInitData {
  user?: TelegramUser;
  chat_instance?: string;
  chat_type?: string;
  auth_date: number;
  hash: string;
}

// ─── User / Profile ──────────────────────────────────────────────────────────

export type ProposalTone = 'short' | 'expert' | 'friendly' | 'premium';

export type FreelancerCategory =
  | 'websites'
  | 'shops'
  | 'telegram_bots'
  | 'ai_agents'
  | 'automation'
  | 'seo'
  | 'google_ads'
  | 'smm'
  | 'design'
  | 'copywriting';

export interface FreelancerProfile {
  id: string;
  userId: string;
  name: string;
  specialization: string;
  services: string;
  experience: string;
  portfolioLinks: string[];
  minBudget: number;
  language: 'uk' | 'ru' | 'en';
  tone: ProposalTone;
  categories: FreelancerCategory[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  telegramId: number;
  name: string;
  username?: string;
  avatar?: string;
  profile?: FreelancerProfile;
  subscription?: Subscription;
  freelancehunt?: FreelancehuntAccount;
  createdAt: string;
}

// ─── Freelancehunt ───────────────────────────────────────────────────────────

export interface FreelancehuntAccount {
  id: string;
  userId: string;
  connected: boolean;
  username?: string;
  connectedAt?: string;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  freelancehuntId: string;
  title: string;
  description: string;
  budget: number;
  budgetMax?: number;
  currency: string;
  category: string;
  skills: string[];
  clientName: string;
  clientRating?: number;
  projectUrl: string;
  publishedAt: string;
  bidsCount: number;
  matchScore?: number;
  isNew?: boolean;
}

export interface ProjectAnalysis {
  fitScore: number;
  complexity: 'low' | 'medium' | 'high';
  strategy: string;
  risks: string[];
  priceMin: number;
  priceMax: number;
  deadline: string;
}

export type ProjectFilter = {
  category?: string;
  budgetMin?: number;
  budgetMax?: number;
  matchMin?: number;
  onlyNew?: boolean;
  search?: string;
};

// ─── Bids ────────────────────────────────────────────────────────────────────

export type BidStatus = 'draft' | 'sent' | 'skipped' | 'replied';

export interface GeneratedBid {
  id: string;
  userId: string;
  projectId: string;
  projectTitle: string;
  text: string;
  price: number;
  deadline: string;
  questions: string[];
  status: BidStatus;
  createdAt: string;
  sentAt?: string;
  /** Freelancehunt-assigned bid ID after submission. */
  freelancehuntBidId?: string;
}

// ─── Subscription ────────────────────────────────────────────────────────────

export type PlanId = 'free' | 'basic' | 'pro' | 'agency';

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  price: number;
  currency: string;
  generationsLimit: number;
  features: string[];
  recommended?: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  plan: PlanId;
  status: 'active' | 'expired' | 'cancelled';
  generationsLimit: number;
  generationsUsed: number;
  startedAt: string;
  expiresAt: string;
}

// ─── Stats / Dashboard ───────────────────────────────────────────────────────

export interface DashboardStats {
  newProjects: number;
  generatedToday: number;
  sentTotal: number;
  generationsLeft: number;
  responseRate: number;
  currentPlan: PlanId;
}

// ─── API Responses ───────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  ok: boolean;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface UserSettings {
  /** Automatically sync projects from Freelancehunt (default: true) */
  autoSync: boolean;
  /** Automatically generate a draft bid for each new project (default: false) */
  autoDraft: boolean;
  /** Always require manual confirmation before sending a bid (default: true) */
  requireConfirmation: boolean;
  /** Freelancer category filters applied during project sync */
  categories: FreelancerCategory[];
  /** Minimum project budget to include during sync (USD) */
  minBudget: number;
}

// ─── In-memory token store (replace with DB in production) ───────────────────

export interface FreelancehuntTokenRecord {
  userId: string;
  /** AES-256-GCM encrypted token — see lib/crypto.ts */
  encryptedToken: string;
  username: string;
  connectedAt: string;
}

// ─── Auto-Bid Settings ────────────────────────────────────────────────────────

export interface AutoBidSettings {
  enabled: boolean;
  dailyLimit: number;
  minBudget: number;
  maxBudget: number;
  minMatchScore: number;
  allowedCategories: FreelancerCategory[];
  blockedKeywords: string[];
  delayBetweenBidsMin: number; // seconds
  delayBetweenBidsMax: number; // seconds
  workingHoursStart: number;   // 0-23
  workingHoursEnd: number;     // 0-23
  workingDays: number[];       // 0=Sun, 1=Mon, ..., 6=Sat
  emergencyStop: boolean;
}

// ─── Auto-Bid Run Log ─────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface AutoBidLog {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  projectId?: string;
  projectTitle?: string;
  bidId?: string;
  meta?: Record<string, unknown>;
}

// ─── Company Profile ──────────────────────────────────────────────────────────

export interface CompanyProfile {
  name: string;
  tagline: string;
  description: string;
  services: string[];
  portfolio: PortfolioItem[];
  bidStyle: ProposalTone;
  language: 'uk' | 'ru' | 'en';
  contacts: {
    telegram?: string;
    email?: string;
    website?: string;
  };
}

export interface PortfolioItem {
  id: string;
  title: string;
  description: string;
  url?: string;
  tags: string[];
}

// ─── Applications (worker output) ────────────────────────────────────────────

export type ApplicationStatus = 'sent' | 'skipped' | 'failed';

/**
 * A record of every project the worker processed — either successfully bid on,
 * or skipped/filtered out. Saved by the orchestrator and surfaced in Dashboard.
 */
export interface Application {
  id: string;
  projectId: string;
  freelancehuntId?: string;
  title: string;
  url: string;
  budget: number;
  currency: string;
  deadline?: string;
  status: ApplicationStatus;
  createdAt: string;
  sentAt?: string;
  /** AI-generated proposal text (only for sent applications) */
  proposalText?: string;
  /** Price proposed by AI */
  proposalPrice?: number;
  /** Freelancehunt bid ID returned after submission */
  freelancehuntBidId?: string;
  /** AI relevance score 0–100 */
  aiScore?: number;
  /** Keywords that matched the allowlist */
  matchedKeywords?: string[];
  /** Keywords that triggered the blocklist */
  blockedKeywords?: string[];
  /** Human-readable reason for skipping */
  skippedReason?: string;
  /** Filter stage that caused the skip */
  filterStage?: string;
}

// ─── Navigation ──────────────────────────────────────────────────────────────

export type NavTab = 'home' | 'projects' | 'settings' | 'logs' | 'history' | 'profile';
