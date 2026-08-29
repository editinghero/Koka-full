# Notification Panel Glass Blur Implementation Guide

This guide explains how to apply the glassmorphism blur effect to the Notification Panel in other projects (e.g., `E:/web/projects/koka`).

---

## Step 1: Add or Update CSS Utility in `src/styles.css`

Ensure Tailwind CSS has the `@utility glass-popover` defined. In Tailwind CSS v4:

```css
@utility glass-popover {
  background-color: color-mix(in srgb, var(--color-popover) 75%, transparent);
  -webkit-backdrop-filter: blur(32px) saturate(180%);
  backdrop-filter: blur(32px) saturate(180%);
}
```

> **Note**: If using Tailwind CSS v3, use `@layer utilities`:
> ```css
> @layer utilities {
>   .glass-popover {
>     background-color: color-mix(in srgb, var(--popover) 75%, transparent);
>     -webkit-backdrop-filter: blur(32px) saturate(180%);
>     backdrop-filter: blur(32px) saturate(180%);
>   }
> }
> ```

---

## Step 2: Update `NotificationsDropdown.tsx`

Open `src/components/NotificationsDropdown.tsx` and make the following two adjustments:

### 1. Main Dropdown Popover Container
Replace the solid background (`bg-popover`) with `glass-popover` and a subtle border:

```diff
- <div className="fixed inset-x-4 top-16 z-50 mx-auto w-auto max-w-sm rounded-2xl border border-border bg-popover p-4 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:max-w-none">
+ <div className="fixed inset-x-4 top-16 z-50 mx-auto w-auto max-w-sm rounded-2xl border border-border/80 glass-popover p-4 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:max-w-none">
```

### 2. Notification Cards Inside the Popover
Make the inner cards translucent so they do not block the underlying blur effect:

```diff
  className={cn(
    "group relative flex cursor-pointer gap-3 rounded-xl border p-2.5 transition-all duration-200 hover:border-primary/40",
    isRead
-     ? "border-border/60 bg-secondary/20 opacity-60"
+     ? "border-border/40 bg-secondary/30 opacity-60"
      : item.isWithin3Hours
-       ? "border-primary/50 bg-primary/5"
+       ? "border-primary/50 bg-primary/10"
-       : "border-border bg-card",
+       : "border-border/60 bg-card/60",
  )}
```

---

## Step 3: Prevent CSS Lint Warnings in IDE

Add `.vscode/settings.json` to the root of the project to prevent IDE warnings on Tailwind v4 `@utility` and `@theme` at-rules:

```json
{
  "css.lint.unknownAtRules": "ignore"
}
```
