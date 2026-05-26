# BidPilot AI — Telegram Mini App

AI-помічник для фрілансерів. Моніторинг проєктів Freelancehunt, генерація персоналізованих заявок через OpenAI, відправка з підтвердженням.

---

## 1. Створення Telegram-бота через BotFather

1. Відкрийте Telegram і знайдіть [@BotFather](https://t.me/BotFather).
2. Надішліть команду `/newbot`.
3. Введіть **назву** бота, наприклад: `BidPilot AI`.
4. Введіть **username** бота (має закінчуватись на `bot`), наприклад: `bidpilot_ai_bot`.
5. BotFather поверне **Bot Token** у форматі `123456789:AAF...` — збережіть його.
6. Налаштуйте команди меню:
   ```
   /setcommands → обрати бота → вставити:
   start - Запустити бота
   help - Допомога
   app - Відкрити додаток
   status - Статус підписки
   ```

---

## 2. Деплой фронтенду на Vercel

### Варіант A — через v0 (рекомендовано)

1. У v0 натисніть кнопку **Publish** у верхньому правому куті.
2. Виберіть або створіть Vercel-проєкт.
3. Deployment відбудеться автоматично.

### Варіант B — через GitHub + Vercel CLI

```bash
git clone https://github.com/your-org/bidpilot-ai.git
cd bidpilot-ai
pnpm install
npx vercel --prod
```

Після деплою ви отримаєте URL вигляду `https://v0-bidpilot-ai-saas.vercel.app`.

---

## 3. Встановлення URL Mini App у BotFather

1. Відкрийте [@BotFather](https://t.me/BotFather).
2. Надішліть `/setmenubutton` → оберіть бота → **Web App**.
3. Вставте URL Vercel-деплою:
   ```
   https://v0-bidpilot-ai-saas.vercel.app
   ```
4. Тепер кнопка у чаті бота відкриватиме Mini App.

Або через `/mybots` → обрати бота → **Bot Settings** → **Menu Button** → **Configure menu button**.

---

## 4. Додавання змінних середовища

Змінні вже додані до проєкту. Для довідки — повний список:

| Змінна | Значення | Опис |
|--------|----------|------|
| `TELEGRAM_BOT_TOKEN` | `8676026319:AAFm...` | Токен бота від BotFather |
| `NEXT_PUBLIC_APP_URL` | `https://v0-bidpilot-ai-saas.vercel.app` | Публічна URL Vercel-деплою |
| `TELEGRAM_WEBHOOK_SECRET` | `IvanivAngelina15032008` | Секрет для верифікації webhook-запитів |
| `OPENAI_API_KEY` | `sk-...` | API ключ OpenAI (додати окремо) |
| `DATABASE_URL` | `postgresql://...` | PostgreSQL (Supabase/Neon, додати окремо) |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` | Шифрування токенів Freelancehunt |
| `WAYFORPAY_MERCHANT_ACCOUNT` | `...` | Мерчант WayForPay (опційно) |
| `WAYFORPAY_SECRET_KEY` | `...` | Секрет WayForPay (опційно) |

> Після зміни змінних зробіть **Redeploy** у Vercel Dashboard.

### Для локальної розробки

Створіть `.env.local`:
```env
TELEGRAM_BOT_TOKEN=8676026319:AAFmZ0kdiAPbMXLpsJJY6fN_uxZ78QxCN-0
NEXT_PUBLIC_APP_URL=https://v0-bidpilot-ai-saas.vercel.app
TELEGRAM_WEBHOOK_SECRET=IvanivAngelina15032008
OPENAI_API_KEY=sk-...
```

---

## 5. Реєстрація Webhook у Telegram

Після деплою відкрийте у браузері:

```
https://v0-bidpilot-ai-saas.vercel.app/api/webhook/setup?secret=IvanivAngelina15032008
```

Очікувана відповідь:
```json
{
  "ok": true,
  "registered": "https://v0-bidpilot-ai-saas.vercel.app/api/webhook",
  "botInfo": { "ok": true, "result": { "username": "bidpilot_ai_bot" } }
}
```

Webhook потрібно реєструвати **один раз** або після зміни домену.

Щоб перевірити поточний стан:
```
https://api.telegram.org/bot8676026319:AAFmZ0kdiAPbMXLpsJJY6fN_uxZ78QxCN-0/getWebhookInfo
```

Щоб видалити webhook (для локальної розробки з ngrok):
```
DELETE https://v0-bidpilot-ai-saas.vercel.app/api/webhook/setup?secret=IvanivAngelina15032008
```

### Тестування webhook локально

```bash
# 1. Встановіть ngrok
ngrok http 3000

# 2. Зареєструйте локальний webhook:
curl "https://abc123.ngrok-free.app/api/webhook/setup?secret=IvanivAngelina15032008"

# 3. Надішліть /start боту — запит прийде на localhost:3000
```

---

## 6. Підключення backend API

### Поточний стан

Усі API-маршрути (`/api/*`) повертають **mock-дані** і готові до заміни на реальні інтеграції. Місця для заміни позначені коментарями `// TODO:`.

### Кроки для production

#### A. База даних (Supabase / Neon)

```bash
pnpm add @supabase/supabase-js
# або для Neon:
pnpm add @neondatabase/serverless
```

Додайте `DATABASE_URL` до Vercel env та замініть `mockUser`, `mockProjects` на реальні запити у відповідних API-маршрутах.

#### B. OpenAI API

```bash
pnpm add openai
```

Відкрийте `services/openai.service.ts` та розкоментуйте `openai.chat.completions.create(...)`.

#### C. Freelancehunt API

Відкрийте `services/freelancehunt.service.ts` та замініть mock-функції на виклики `https://api.freelancehunt.com/v2`. Документація: https://freelancehunt.com/developers

#### D. Платежі (WayForPay)

Відкрийте `app/api/subscription/checkout/route.ts` та додайте реальний виклик WayForPay API з `WAYFORPAY_MERCHANT_ACCOUNT` і `WAYFORPAY_SECRET_KEY`.

---

## Структура проєкту

```
app/
  api/                      # API маршрути (Next.js App Router)
    auth/telegram/          # Telegram initData авторизація
    profile/                # GET/PUT профіль фрілансера
    projects/               # Список та синхронізація проєктів
    generate-bid/           # POST генерація заявки через OpenAI
    send-bid/               # POST відправка заявки на Freelancehunt
    history/                # GET історія заявок
    subscription/           # GET статус, POST checkout
    freelancehunt/connect/  # POST підключення акаунту
  page.tsx                  # Головний SPA-роутер
  layout.tsx                # Root layout з Telegram SDK
  globals.css               # Tailwind v4 + дизайн-токени

components/
  providers/
    TelegramProvider.tsx    # Context: user, isReady, isTelegramEnv
  screens/
    WelcomeScreen.tsx
    ProfileSetupScreen.tsx
    FreelancehuntConnectScreen.tsx
    DashboardScreen.tsx
    ProjectsScreen.tsx
    AiBidScreen.tsx
    HistoryScreen.tsx
    ProfileScreen.tsx
    SubscriptionScreen.tsx
  shared/
    BottomNavigation.tsx
    ProjectCard.tsx
    BidPreview.tsx
    PricingCard.tsx
    StatCard.tsx
    ConnectionStatus.tsx
    LoadingState.tsx
    EmptyState.tsx
    ConfirmModal.tsx

hooks/
  useTelegram.ts            # React hook для Telegram WebApp

lib/
  telegram.ts               # Telegram WebApp SDK helpers
  mock-data.ts              # Mock дані (замінити на реальні API)
  utils.ts                  # cn() та утиліти

services/
  openai.service.ts         # AI генерація заявок
  freelancehunt.service.ts  # Freelancehunt API
  telegram.service.ts       # Telegram Bot API
  payment.service.ts        # WayForPay / LiqPay
  subscription.service.ts   # Логіка підписок

types/
  index.ts                  # TypeScript типи для всього проєкту
```
