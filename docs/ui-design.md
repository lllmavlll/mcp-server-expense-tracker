# UI Technical Design Document: Expense Tracker

## Overview

This document covers the UI architecture, component structure, pages, and animation approach for the Expense Tracker application. The focus is purely on the frontend — no APIs or DB schema are covered here.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 14+ (App Router) |
| UI Components | Shadcn UI |
| Styling | Tailwind CSS |
| Animations | Framer Motion |
| Icons | Lucide React (comes with Shadcn) |
| Font | Geist (Next.js default) |

---

## Application Routes

```
app/
├── (auth)/
│   └── login/
│       └── page.tsx          ← Auth page (login + signup toggle)
│
└── (app)/
    ├── layout.tsx            ← Shared app layout (sidebar + topbar)
    ├── dashboard/
    │   └── page.tsx          ← Dashboard with summary + charts
    ├── expenses/
    │   └── page.tsx          ← Expense list + CRUD + AI chat flyout
    └── settings/
        └── page.tsx          ← Profile + preferences
```

Route groups `(auth)` and `(app)` keep layouts separate — the auth page has no sidebar, while all app pages share the sidebar layout.

---

## Global App Layout (`(app)/layout.tsx`)

All authenticated pages share this layout:

```
┌──────────────────────────────────────────────────────┐
│  Sidebar (fixed left, 240px)  │  Main Content Area   │
│                               │                      │
│  Logo                         │  [page content]      │
│  ─────                        │                      │
│  Dashboard                    │                      │
│  Expenses                     │                      │
│  Settings                     │                      │
│                               │                      │
│  ─────                        │                      │
│  User avatar + name           │                      │
└──────────────────────────────────────────────────────┘
```

- Sidebar is fixed/sticky, collapses to icon-only on smaller screens
- Main content area scrolls independently
- Sidebar uses Framer Motion for collapse/expand animation

---

## Pages

---

### 1. Auth Page — `/login`

**Purpose:** Single page handling both login and signup via a toggle.

**Layout:**
```
┌────────────────────────────────────────┐
│                                        │
│         [App Logo + Name]              │
│                                        │
│   ┌────────────────────────────────┐   │
│   │  Login  │  Sign Up             │   │  ← Tab toggle
│   │─────────────────────────────── │   │
│   │  Email                         │   │
│   │  Password                      │   │
│   │  [Forgot password?]            │   │
│   │                                │   │
│   │  [Continue]                    │   │
│   └────────────────────────────────┘   │
│                                        │
└────────────────────────────────────────┘
```

**Shadcn Components:**
- `Card`, `CardHeader`, `CardContent` — form container
- `Input`, `Label` — form fields
- `Button` — submit
- `Tabs`, `TabsList`, `TabsTrigger` — login/signup toggle

**Framer Motion:**
- Card fades + slides up on page mount
- Tab content cross-fades when switching between login and signup

---

### 2. Dashboard — `/dashboard`

**Purpose:** At-a-glance overview of spending — summary cards, chart, and recent transactions.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  Good morning, Mahesh          March 2026           │
│                                                     │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐        │
│  │ This Month│  │ Top Cat.  │  │ Avg/Day   │        │  ← Summary cards
│  │  ₹12,400  │  │  Food     │  │  ₹420     │        │
│  └───────────┘  └───────────┘  └───────────┘        │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  Monthly Spending (last 6 months)           │    │  ← Bar chart
│  │  [bar chart]                                │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Recent Expenses                    [View all →]    │
│  ┌─────────────────────────────────────────────┐    │
│  │  Groceries  •  Mar 23  •  ₹800             │    │
│  │  Transport  •  Mar 22  •  ₹150             │    │
│  │  Coffee     •  Mar 22  •  ₹120             │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**Shadcn Components:**
- `Card` — summary cards and chart container
- `Badge` — category labels on recent expenses
- `Separator` — section dividers
- `Button` (variant ghost) — "View all" link

**Framer Motion:**
- Summary cards stagger in from bottom on mount (0.1s delay between each)
- Chart bars animate height from 0 on mount
- Recent expense rows fade + slide in with stagger

---

### 3. Expenses Page — `/expenses`

**Purpose:** Full expense management — list, filter, create, edit, delete. Also hosts the AI chat flyout.

**Layout (chat closed):**
```
┌─────────────────────────────────────────────────────┐
│  Expenses                        [+ Add Expense]    │
│                                                     │
│  [Search...]  [Category ▼]  [Date Range ▼]          │  ← Filters
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  Date      Description    Category   Amount │    │
│  │  ──────────────────────────────────────── │    │
│  │  Mar 23    Groceries      Food       ₹800  │    │
│  │  Mar 22    Uber           Transport  ₹150  │    │
│  │  Mar 22    Starbucks      Coffee     ₹120  │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│                              [🤖 AI Chat]           │  ← Floating button
└─────────────────────────────────────────────────────┘
```

**Layout (chat open — push behavior):**
```
┌──────────────────────────┬──────────────────────────┐
│  Expenses (shrunk)       │  AI Chat Panel           │
│                          │                          │
│  [compressed list]       │  [chat messages]         │
│                          │                          │
│                          │  [Type a message...]  ➤  │
└──────────────────────────┴──────────────────────────┘
```

The main content area shrinks horizontally — it does not get covered. The chat panel pushes the content from the right.

**Shadcn Components:**
- `Table`, `TableHeader`, `TableRow`, `TableCell` — expense list
- `Input` — search bar
- `Select` — category filter
- `DatePickerWithRange` — date filter
- `Dialog` — add/edit expense form
- `AlertDialog` — delete confirmation
- `DropdownMenu` — row actions (edit, delete)
- `Badge` — category chip
- `Button` — add expense, floating chat trigger
- `Sheet` — NOT used for chat (custom push panel instead)
- `Form`, `FormField`, `Input`, `Select` — inside add/edit dialog

**Framer Motion:**
- Main content area: `animate={{ width: chatOpen ? "60%" : "100%" }}` with spring transition
- Chat panel: `animate={{ x: chatOpen ? 0 : "100%" }}` slides in from right
- Table rows: stagger fade-in on initial load and when filters change
- Floating button: subtle pulse/bounce idle animation, scale on hover

---

### 3a. AI Chat Panel (within Expenses page)

**Purpose:** Natural language interface to interact with expense data — add, query, edit, delete via conversation.

**Layout:**
```
┌──────────────────────────────────┐
│  AI Assistant              [✕]   │  ← Header with close button
│──────────────────────────────────│
│                                  │
│  ┌──────────────────────────┐    │
│  │ How can I help you with  │    │  ← Assistant message bubble
│  │ your expenses today?     │    │
│  └──────────────────────────┘    │
│                                  │
│      ┌───────────────────────┐   │
│      │ Add ₹500 for dinner   │   │  ← User message bubble
│      └───────────────────────┘   │
│                                  │
│  ┌──────────────────────────┐    │
│  │ Done! Added ₹500 under   │    │
│  │ Food for today.          │    │
│  └──────────────────────────┘    │
│                                  │
│──────────────────────────────────│
│  [Type a message...]         [➤] │  ← Input + send
└──────────────────────────────────┘
```

**Behavior:**
- Panel width: ~400px (fixed), takes space from the right edge of the viewport
- Main content area animates its right margin/width to accommodate
- Chat persists state while navigating (stored in React context or Zustand)
- Typing indicator (3-dot animation) while AI is responding
- Messages scroll independently inside the panel
- Streamed responses render word-by-word

**Shadcn Components:**
- `Input` — message input
- `Button` — send, close
- `ScrollArea` — message history

**Framer Motion:**
- Panel: `x` animation (slides in/out)
- Main content: `width` or `paddingRight` animation (push effect)
- Message bubbles: fade + slide up as they appear
- Typing indicator: looping dot bounce animation

---

### 4. Settings Page — `/settings`

**Purpose:** User profile management and app preferences.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  Settings                                           │
│                                                     │
│  Profile                                            │
│  ┌─────────────────────────────────────────────┐    │
│  │  [Avatar]  Mahesh KN                        │    │
│  │            mahesh@email.com                 │    │
│  │            [Change photo]                   │    │
│  │                                             │    │
│  │  Full Name    [___________________]         │    │
│  │  Email        [___________________]         │    │
│  │               [Save changes]               │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Preferences                                        │
│  ┌─────────────────────────────────────────────┐    │
│  │  Currency         [INR (₹)  ▼]              │    │
│  │  Date Format      [DD/MM/YYYY ▼]            │    │
│  │  Default Category [Food ▼]                  │    │
│  │  Theme            [ Light ◉ ] [ Dark ○ ]    │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**Shadcn Components:**
- `Card` — section containers
- `Avatar`, `AvatarImage`, `AvatarFallback` — profile picture
- `Form`, `FormField`, `Input`, `Label` — profile form
- `Select` — currency, date format, default category
- `Switch` — toggle preferences
- `Separator` — between sections
- `Button` — save changes

**Framer Motion:**
- Sections fade + slide up on page mount with stagger
- Save button: brief scale pulse on success

---

## Component Architecture

```
components/
├── layout/
│   ├── Sidebar.tsx           ← App sidebar with nav links
│   ├── TopBar.tsx            ← Page title + breadcrumb (optional)
│   └── ChatPanel.tsx         ← AI chat flyout panel
│
├── dashboard/
│   ├── SummaryCard.tsx       ← Individual stat card
│   ├── SpendingChart.tsx     ← Bar chart component
│   └── RecentExpenses.tsx    ← Recent transactions list
│
├── expenses/
│   ├── ExpenseTable.tsx      ← Main expenses table
│   ├── ExpenseFilters.tsx    ← Search + filter bar
│   ├── ExpenseDialog.tsx     ← Add/edit modal
│   ├── DeleteDialog.tsx      ← Confirm delete
│   └── ChatFAB.tsx           ← Floating action button
│
├── chat/
│   ├── MessageBubble.tsx     ← Individual message
│   ├── TypingIndicator.tsx   ← 3-dot loading animation
│   └── ChatInput.tsx         ← Input + send button
│
└── settings/
    ├── ProfileForm.tsx
    └── PreferencesForm.tsx
```

---

## Animation Principles (Framer Motion)

Keep animations subtle and purposeful — they should aid comprehension, not distract.

| Interaction | Animation | Duration |
|---|---|---|
| Page mount | Fade + slide up (y: 20 → 0) | 300ms |
| Staggered lists | Each item delays by 50ms | 200ms each |
| Chat panel open/close | Slide x + main content width | 350ms spring |
| Modal open | Scale (0.95 → 1) + fade | 200ms |
| Button hover | Scale 1.02 | 150ms |
| Success feedback | Brief scale pulse | 200ms |
| Typing indicator | Looping bounce (3 dots) | 600ms loop |

All animations use `spring` or `easeOut` — avoid linear easing for UI motion.

---

## State Management

No global state library needed for UI-only scope. Use:

| State | Where |
|---|---|
| Chat open/closed | React Context (`ChatContext`) — so any page can trigger it |
| Chat messages | Same `ChatContext` — persists across page navigations |
| Expense filters | Local state in `ExpenseFilters` component |
| Auth state | Next.js middleware + cookie/session |
| User preferences | Local state in settings, later persisted to DB |

---

## Theming

Shadcn uses CSS variables for theming. Support light and dark mode via:
- Shadcn's built-in theme variables
- `next-themes` package for system/manual toggle
- Toggle available in settings page

---

## Implementation Order (UI only)

1. **Init Next.js project** — `npx create-next-app@latest`, enable TypeScript + Tailwind + App Router
2. **Install Shadcn** — `npx shadcn@latest init`, add required components
3. **Install Framer Motion** — `npm install framer-motion`
4. **Build layout** — Sidebar, app layout shell, route groups
5. **Auth page** — Login/signup toggle with animations
6. **Dashboard** — Summary cards + chart (static/mock data for now)
7. **Expenses page** — Table + filters + add/edit/delete dialogs
8. **Chat panel** — Floating button + push animation + chat UI (static for now)
9. **Settings page** — Profile + preferences forms
10. **Polish** — Stagger animations, hover states, dark mode

---

## Mock Data Strategy

Since APIs are not built yet, use static mock data in each page:

```typescript
// lib/mock-data.ts
export const mockExpenses = [
  { id: '1', amount: 800, category: 'Food', description: 'Groceries', date: '2026-03-23' },
  { id: '2', amount: 150, category: 'Transport', description: 'Uber', date: '2026-03-22' },
  ...
]
```

Pages consume mock data directly. When the API layer is built, swap the import for a real fetch call — no component changes needed.
