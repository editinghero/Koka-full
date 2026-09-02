import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Library,
  Compass,
  Newspaper,
  Sparkles,
  NotebookPen,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Import,
  Search as SearchIcon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useMediaMode, useSettings } from "@/lib/store";
import { GlobalSearch, SearchTrigger } from "@/components/GlobalSearch";
import { NotificationsDropdown } from "@/components/NotificationsDropdown";
import { SplashScreen } from "@/components/SplashScreen";
import type { MediaType } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/library", label: "Library", icon: Library },
  { to: "/seasons", label: "Discover", icon: Compass },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/insights", label: "Insights", icon: Sparkles },
  { to: "/notes", label: "Notes", icon: NotebookPen },
  { to: "/import", label: "Import", icon: Import },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

const BOTTOM_NAV = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/library", label: "Library", icon: Library },
  { to: "/seasons", label: "Discover", icon: Compass },
  { to: "/news", label: "News", icon: Newspaper },
] as const;

/** Pages that already live in the floating bar are dropped from the sheet. */
const SECONDARY_NAV = NAV.filter(
  (item) => !BOTTOM_NAV.some((b) => b.to === item.to),
);

function ThemeToggle() {
  const { settings, update } = useSettings();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted ? settings.theme === "dark" : true;
  return (
    <button
      onClick={() => update({ theme: dark ? "light" : "dark" })}
      aria-label="Toggle theme"
      className="flex h-8 w-8 md:h-9 md:w-9 items-center justify-center rounded-full md:rounded-lg border border-border text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function ModeSwitch({ className }: { className?: string }) {
  const { mode, setMode } = useMediaMode();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const currentMode = mounted ? mode : "ANIME";
  const navigate = useNavigate();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  const handleModeChange = (newMode: MediaType) => {
    if (newMode === mode) return;
    setMode(newMode);
    if (pathname.startsWith("/anime/")) {
      navigate({ to: "/" });
    }
  };

  const options: { value: MediaType; label: string }[] = [
    { value: "ANIME", label: "Anime" },
    { value: "MANGA", label: "Manga" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Media type"
      className={cn(
        "relative flex items-center rounded-full border border-border bg-surface p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const active = currentMode === o.value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => handleModeChange(o.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-all duration-300 active:scale-95",
              active
                ? "bg-primary text-primary-foreground shadow-[var(--shadow-soft)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Keeps children mounted through the closing animation. */
function useAnimatedPresence(open: boolean, ms = 220) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return mounted;
}

function NavGrid({
  items,
  pathname,
  onNavigate,
}: {
  items: readonly {
    to: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {items.map((item) => {
        const active =
          item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm transition-all duration-200 active:scale-[0.97]",
              active
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sheetMounted = useAnimatedPresence(sheetOpen, 260);

  const dark = settings.theme === "dark";
  const preset = dark ? settings.darkTheme : settings.lightTheme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.dataset["theme"] = preset;
  }, [dark, preset]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      if (e.key === "Escape") setSheetOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col justify-between border-r border-border/80 bg-card/90 p-4 backdrop-blur-2xl transition-all duration-300 md:flex",
          collapsed ? "w-16 items-center px-2" : "w-60",
        )}
      >
        <div className="flex flex-col gap-6">
          <Link
            to="/"
            className={cn(
              "flex items-center gap-3 transition-opacity hover:opacity-80",
              collapsed && "justify-center",
            )}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
              <span className="font-display text-base font-bold">K</span>
            </div>
            {!collapsed ? (
              <span className="font-display text-lg font-bold tracking-tight">
                Koka
              </span>
            ) : null}
          </Link>

          <nav className="flex flex-col gap-1">
            {NAV.map((item) => {
              const active =
                item.to === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 active:scale-95",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-primary text-primary-foreground shadow-[var(--shadow-soft)]"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed ? <span>{item.label}</span> : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div
          className={cn(
            "flex items-center pt-3",
            collapsed ? "justify-center" : "justify-between px-1",
          )}
        >
          {!collapsed ? (
            <span className="text-[11px] text-muted-foreground">
              Synced to your account
            </span>
          ) : null}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>

      <div className={cn(collapsed ? "md:pl-16" : "md:pl-60")}>
        {/* desktop top header */}
        <header className="sticky top-0 z-20 hidden border-b border-border/80 glass-header px-8 py-3 will-change-transform md:block">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <ModeSwitch />
            <div className="flex items-center gap-2">
              <div className="w-56">
                <SearchTrigger onClick={() => setSearchOpen(true)} />
              </div>
              <NotificationsDropdown />
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* mobile floating header */}
        <header className="sticky top-3 z-30 mx-3 rounded-full border border-border/80 glass-header px-4 py-2 shadow-[var(--shadow-soft)] will-change-transform md:hidden">
          <div className="flex items-center justify-between gap-2">
            <ModeSwitch />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSearchOpen(true)}
                aria-label="Search"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-95"
              >
                <SearchIcon className="h-4 w-4" />
              </button>
              <NotificationsDropdown />
              <Link
                to="/settings"
                aria-label="Settings"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-95"
              >
                <SettingsIcon className="h-4 w-4" />
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 md:px-8 md:pt-8 md:pb-12">
          <div
            key={pathname}
            className="animate-in duration-200 fade-in-0 slide-in-from-bottom-1 ease-out"
          >
            {children}
          </div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <div className="flex w-full max-w-sm items-center justify-between gap-1 rounded-full border border-border/80 glass-bottom-bar px-2 py-1.5 shadow-[var(--shadow-soft)] will-change-transform">
          {BOTTOM_NAV.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                onClick={() => setSheetOpen(false)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 rounded-full px-2 py-1.5 text-[10px] transition-all duration-200 active:scale-95",
                  active
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={() => setSheetOpen((o) => !o)}
            aria-label={sheetOpen ? "Close menu" : "More"}
            aria-expanded={sheetOpen}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 rounded-full px-2 py-1.5 text-[10px] transition-all duration-200 active:scale-95",
              sheetOpen
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            <span className="relative flex h-4 w-4 items-center justify-center">
              <MoreHorizontal
                className={cn(
                  "absolute h-4 w-4 transition-all duration-200",
                  sheetOpen ? "scale-75 opacity-0" : "scale-100 opacity-100",
                )}
              />
              <X
                className={cn(
                  "absolute h-4 w-4 transition-all duration-200",
                  sheetOpen ? "scale-100 opacity-100" : "scale-75 opacity-0",
                )}
              />
            </span>
            {sheetOpen ? "Close" : "More"}
          </button>
        </div>
      </nav>

      {sheetMounted ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setSheetOpen(false)}
            className={cn(
              "absolute inset-0 bg-background/70 backdrop-blur-md duration-200",
              sheetOpen
                ? "animate-in fade-in-0"
                : "animate-out fade-out-0 fill-mode-forwards",
            )}
          />
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 px-3 pb-[max(4.75rem,calc(env(safe-area-inset-bottom)+4rem))] duration-300",
              sheetOpen
                ? "animate-in fade-in-0 slide-in-from-bottom-8"
                : "animate-out fade-out-0 slide-out-to-bottom-8 fill-mode-forwards",
            )}
          >
            <div className="rounded-3xl border border-border/80 bg-background/92 p-3 shadow-[var(--shadow-soft)] backdrop-blur-3xl">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
              <NavGrid
                items={SECONDARY_NAV}
                pathname={pathname}
                onNavigate={() => setSheetOpen(false)}
              />
            </div>
          </div>
        </div>
      ) : null}

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <SplashScreen />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
