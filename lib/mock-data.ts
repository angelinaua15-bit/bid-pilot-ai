/**
 * lib/mock-data.ts
 * Mock data for development / demo mode.
 * Replace each section with real API calls when integrations are ready.
 */

import type {
  User,
  Project,
  GeneratedBid,
  Subscription,
  DashboardStats,
  SubscriptionPlan,
  AutoBidSettings,
  AutoBidLog,
  CompanyProfile,
} from '@/types';

// ─── Mock Telegram User ───────────────────────────────────────────────────────

export const mockTelegramUser = {
  id: 6237272293,
  first_name: 'Angel',
  last_name: '',
  username: 'angeixxxx',
  photo_url: '',
  language_code: 'uk',
  is_premium: true,
};

// ─── Mock User ────────────────────────────────────────────────────────────────

export const mockUser: User = {
  id: 'usr_001',
  telegramId: 123456789,
  name: 'Олексій Ковальчук',
  username: 'alexkovalchuk',
  avatar: '',
  profile: {
    id: 'prf_001',
    userId: 'usr_001',
    name: 'Олексій Ковальчук',
    specialization: 'Full-stack розробник',
    services: 'Веб-сайти, Telegram-боти, AI-агенти, Автоматизація',
    experience: '5 років досвіду. Клієнти з України, Польщі та Німеччини.',
    portfolioLinks: ['https://alexdev.ua', 'https://github.com/alexkovalchuk'],
    minBudget: 500,
    language: 'uk',
    tone: 'expert',
    categories: ['websites', 'telegram_bots', 'ai_agents', 'automation'],
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-11-01T12:00:00Z',
  },
  subscription: {
    id: 'sub_001',
    userId: 'usr_001',
    plan: 'pro',
    status: 'active',
    generationsLimit: 500,
    generationsUsed: 123,
    startedAt: '2024-11-01T00:00:00Z',
    expiresAt: '2024-12-01T00:00:00Z',
  },
  freelancehunt: {
    id: 'fh_001',
    userId: 'usr_001',
    connected: true,
    username: 'alex_dev_ua',
    connectedAt: '2024-11-01T10:00:00Z',
  },
  createdAt: '2024-01-15T10:00:00Z',
};

// ─── Mock Projects ────────────────────────────────────────────────────────────

export const mockProjects: Project[] = [
  {
    id: 'prj_001',
    freelancehuntId: 'fh_prj_001',
    title: 'Розробка Telegram-бота для інтернет-магазину',
    description:
      'Потрібен бот з каталогом товарів, кошиком, оплатою через LiqPay та адмін-панеллю для управління замовленнями. Магазин продає косметику. Є API від 1C.',
    budget: 800,
    budgetMax: 1500,
    currency: 'USD',
    category: 'Telegram-боти',
    skills: ['Node.js', 'Telegram Bot API', 'PostgreSQL'],
    clientName: 'Марія Т.',
    clientRating: 4.9,
    projectUrl: 'https://freelancehunt.com/project/001',
    publishedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    bidsCount: 3,
    matchScore: 97,
    isNew: true,
  },
  {
    id: 'prj_002',
    freelancehuntId: 'fh_prj_002',
    title: 'AI-чатбот для служби підтримки SaaS',
    description:
      'Нам потрібен інтелектуальний чатбот на базі GPT-4 для відповідей на питання клієнтів. Потрібна інтеграція з Zendesk та можливість ескалації до живого оператора.',
    budget: 1200,
    budgetMax: 2000,
    currency: 'USD',
    category: 'AI-агенти',
    skills: ['OpenAI', 'Python', 'LangChain', 'Zendesk API'],
    clientName: 'StartupHub',
    clientRating: 5.0,
    projectUrl: 'https://freelancehunt.com/project/002',
    publishedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    bidsCount: 7,
    matchScore: 91,
    isNew: true,
  },
  {
    id: 'prj_003',
    freelancehuntId: 'fh_prj_003',
    title: 'Лендінг для IT-компанії з анімаціями',
    description:
      'Потрібен сучасний лендінг для IT-компанії. Дизайн вже є у Figma. Потрібно верстати на Next.js. Плавні анімації, мобільна адаптація, SEO.',
    budget: 400,
    budgetMax: 700,
    currency: 'USD',
    category: 'Веб-сайти',
    skills: ['Next.js', 'Tailwind CSS', 'Framer Motion'],
    clientName: 'Ігор В.',
    clientRating: 4.7,
    projectUrl: 'https://freelancehunt.com/project/003',
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    bidsCount: 12,
    matchScore: 84,
    isNew: false,
  },
  {
    id: 'prj_004',
    freelancehuntId: 'fh_prj_004',
    title: 'Автоматизація парсингу та обробки даних',
    description:
      'Потрібно автоматизувати збір даних з кількох сайтів, обробку та завантаження в Google Sheets. Запуск по розкладу раз на день.',
    budget: 300,
    budgetMax: 600,
    currency: 'USD',
    category: 'Автоматизація',
    skills: ['Python', 'Selenium', 'Google Sheets API'],
    clientName: 'Аналітик Pro',
    clientRating: 4.8,
    projectUrl: 'https://freelancehunt.com/project/004',
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    bidsCount: 5,
    matchScore: 78,
    isNew: false,
  },
  {
    id: 'prj_005',
    freelancehuntId: 'fh_prj_005',
    title: 'Інтернет-магазин на Next.js + Stripe',
    description:
      'Потрібен повноцінний e-commerce на Next.js з Stripe-оплатою, адмін-панеллю, каталогом. Є дизайн у Figma.',
    budget: 1500,
    budgetMax: 3000,
    currency: 'USD',
    category: 'Інтернет-магазини',
    skills: ['Next.js', 'Stripe', 'PostgreSQL', 'Prisma'],
    clientName: 'FashionStore UA',
    clientRating: 4.6,
    projectUrl: 'https://freelancehunt.com/project/005',
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    bidsCount: 9,
    matchScore: 88,
    isNew: false,
  },
];

// ─── Mock Bids / History ──────────────────────────────────────────────────────

export const mockBids: GeneratedBid[] = [
  {
    id: 'bid_001',
    userId: 'usr_001',
    projectId: 'prj_001',
    projectTitle: 'Розробка Telegram-бота для інтернет-магазину',
    text: 'Привіт! Я маю 5 років досвіду у розробці Telegram-ботів з оплатою та адмін-панелями. Реалізую вашого бота на Node.js + Telegraf з PostgreSQL та інтеграцією LiqPay. Адмін-панель зроблю на Next.js. Готовий взятись одразу.',
    price: 1200,
    deadline: '14 днів',
    questions: [
      'Яка кількість товарів у каталозі?',
      'Чи потрібна мультимовність?',
      'Яка CRM у вас зараз?',
    ],
    status: 'sent',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 1.5).toISOString(),
  },
  {
    id: 'bid_002',
    userId: 'usr_001',
    projectId: 'prj_002',
    projectTitle: 'AI-чатбот для служби підтримки SaaS',
    text: 'Маю досвід інтеграції GPT-4 з Zendesk і побудови RAG-систем. Можу реалізувати повноцінний чатбот з ескалацією, аналітикою та навчанням на ваших даних.',
    price: 1800,
    deadline: '21 день',
    questions: [
      'Скільки тікетів на місяць обробляє підтримка?',
      'Якою мовою спілкуються клієнти?',
    ],
    status: 'draft',
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: 'bid_003',
    userId: 'usr_001',
    projectId: 'prj_003',
    projectTitle: 'Лендінг для IT-компанії з анімаціями',
    text: 'Зроблю лендінг на Next.js 14 + Framer Motion. Перфектна мобільна адаптація, SEO, Core Web Vitals 90+.',
    price: 600,
    deadline: '7 днів',
    questions: ['Чи є брендбук?'],
    status: 'replied',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3 + 1000 * 60 * 30).toISOString(),
  },
];

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export const mockStats: DashboardStats = {
  newProjects: 12,
  generatedToday: 4,
  sentTotal: 47,
  generationsLeft: 377,
  responseRate: 34,
  currentPlan: 'pro',
};

// ─── Subscription Plans ───────────────────────────────────────────────────────

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'грн',
    generationsLimit: 10,
    features: [
      '10 AI-генерацій / місяць',
      'Ручний пошук проєктів',
      'Базова генерація заявок',
    ],
  },
  {
    id: 'basic',
    name: 'Basic',
    price: 199,
    currency: 'грн',
    generationsLimit: 100,
    features: [
      '100 AI-генерацій / місяць',
      'Моніторинг проєктів',
      'Генерація заявок',
      'Історія заявок',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 499,
    currency: 'грн',
    generationsLimit: 500,
    features: [
      '500 AI-генерацій / місяць',
      'Розширений AI-аналіз',
      'Смарт-фільтри',
      'Пріоритетна генерація',
      'Підключення Freelancehunt',
    ],
    recommended: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    price: 999,
    currency: 'грн',
    generationsLimit: 2000,
    features: [
      '2000 AI-генерацій / місяць',
      'Кілька профілів фрілансера',
      'Командний доступ',
      'Адмін-дашборд',
      'Пріоритетна підтримка',
    ],
  },
];

// ─── Auto-Bid Settings Default ───────────────────────────────────────────────

export const defaultAutoBidSettings: AutoBidSettings = {
  enabled: true,
  dailyLimit: 20,
  minBudget: 300,
  maxBudget: 10000,
  minMatchScore: 70,
  allowedCategories: ['websites', 'telegram_bots', 'ai_agents', 'automation', 'seo', 'google_ads', 'smm', 'design'],
  blockedKeywords: ['дешево', 'безкоштовно', 'за копійки', 'стажер', 'недорого'],
  delayBetweenBidsMin: 120,
  delayBetweenBidsMax: 300,
  workingHoursStart: 9,
  workingHoursEnd: 22,
  workingDays: [1, 2, 3, 4, 5],
  emergencyStop: false,
};

// ─── Company Profile ──────────────────────────────────────────────────────────

export const companyProfile: CompanyProfile = {
  name: 'King Kong Lab',
  tagline: 'Websites. Bots. AI. Automation.',
  description:
    'Ми — King Kong Lab. Розробляємо сайти, Telegram-боти, AI-агентів та автоматизацію для бізнесу. Наші клієнти отримують рішення, що реально працюють і масштабуються.',
  services: ['websites', 'telegram_bots', 'ai_agents', 'automation', 'seo', 'google_ads', 'smm', 'design'],
  bidStyle: 'short',
  language: 'uk',
  portfolio: [
    {
      id: 'p1',
      title: 'AI-консультант для e-commerce',
      description: 'GPT-4 чатбот з RAG на базі каталогу товарів. Відповідає на 80% питань без оператора.',
      url: 'https://kingkonglab.com/cases/ai-ecommerce',
      tags: ['ai_agents', 'automation'],
    },
    {
      id: 'p2',
      title: 'Telegram-бот для мережі ресторанів',
      description: 'Меню, бронювання, програма лояльності, адмін-панель. 3000+ активних користувачів.',
      url: 'https://kingkonglab.com/cases/restaurant-bot',
      tags: ['telegram_bots'],
    },
    {
      id: 'p3',
      title: 'SEO + Google Ads для SaaS',
      description: 'Зростання органічного трафіку на 340% за 6 місяців. ROAS 8.2 для платних кампаній.',
      url: 'https://kingkonglab.com/cases/seo-saas',
      tags: ['seo', 'google_ads'],
    },
  ],
  contacts: {
    telegram: '@kingkonglab',
    email: 'hello@kingkonglab.com',
    website: 'https://kingkonglab.com',
  },
};

// ─── Mock Logs ────────────────────────────────────────────────────────────────

export const mockLogs: AutoBidLog[] = [
  {
    id: 'log_001',
    timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    level: 'success',
    message: 'Заявку відправлено',
    projectId: 'prj_001',
    projectTitle: 'Розробка Telegram-бота для інтернет-магазину',
    bidId: 'bid_auto_001',
    meta: { price: 1200, deadline: '14 днів', matchScore: 97 },
  },
  {
    id: 'log_002',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    level: 'info',
    message: 'Проєкт проаналізовано — matchScore 97, пройшов фільтр',
    projectId: 'prj_001',
    projectTitle: 'Розробка Telegram-бота для інтернет-магазину',
    meta: { matchScore: 97, minRequired: 70 },
  },
  {
    id: 'log_003',
    timestamp: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
    level: 'info',
    message: 'Знайдено 5 нових проєктів після синхронізації',
    meta: { count: 5 },
  },
  {
    id: 'log_004',
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    level: 'warning',
    message: 'Проєкт відхилено — бюджет нижче мінімального',
    projectId: 'prj_low',
    projectTitle: 'Зробити сайт-візитку дешево',
    meta: { budget: 50, minBudget: 300 },
  },
  {
    id: 'log_005',
    timestamp: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
    level: 'warning',
    message: 'Проєкт відхилено — заблоковане слово "дешево"',
    projectId: 'prj_low',
    projectTitle: 'Зробити сайт-візитку дешево',
    meta: { keyword: 'дешево' },
  },
  {
    id: 'log_006',
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    level: 'success',
    message: 'Заявку відправлено',
    projectId: 'prj_002',
    projectTitle: 'AI-чатбот для служби підт��имки SaaS',
    bidId: 'bid_auto_002',
    meta: { price: 1800, deadline: '21 день', matchScore: 91 },
  },
  {
    id: 'log_007',
    timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    level: 'info',
    message: 'Auto-bid цикл запущено. Ліміт сьогодні: 20',
    meta: { dailyUsed: 2, dailyLimit: 20 },
  },
  {
    id: 'log_008',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    level: 'error',
    message: 'Помилка API Freelancehunt — 429 Rate Limited',
    meta: { retryAfter: 60 },
  },
];

// ─── Generated Bid Template ───────────────────────────────────────────────────

export function mockGenerateBid(projectTitle: string, tone: string): GeneratedBid {
  const toneText = {
    short: 'Привіт! Маю релевантний досвід. Готовий реалізувати швидко та якісно.',
    expert:
      'Вітаю! Маю 5+ років досвіду в цій ніші. Пропоную архітектурно вивірене рішення з гарантією результату та повною технічною документацією.',
    friendly:
      'Привіт! Бачу ваш проєкт і він мені дуже цікавий. Вже маю схожий кейс і знаю, як це зробити добре. Давайте обговоримо деталі!',
    premium:
      'Доброго дня. Я спеціалізуюсь саме на таких проєктах. Мої клієнти — це компанії, яким важлива якість і результат. Готовий стати вашим партнером.',
  };

  return {
    id: `bid_${Date.now()}`,
    userId: 'usr_001',
    projectId: `prj_${Date.now()}`,
    projectTitle,
    text: toneText[tone as keyof typeof toneText] ?? toneText.expert,
    price: 1000,
    deadline: '14 днів',
    questions: [
      'Чи є технічне завдання або Figma-макет?',
      'Які терміни критичні для запуску?',
      'Чи є вже діюча система, яку треба інтегрувати?',
    ],
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
}
