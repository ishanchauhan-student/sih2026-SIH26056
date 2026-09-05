import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  FileBarChart,
  Info,
  MapPin,
  Plane,
  RefreshCw,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  TrendingUp,
  Wifi,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getGetIndexQueryKey,
  getGetRawDataQueryKey,
  useGetIndex,
  useGetRawData,
  useTriggerScrape,
} from '@workspace/api-client-react';
import type { FareObservation, IndexPoint } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const formatINR = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (value?: string, options?: Intl.DateTimeFormatOptions) => {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', options ?? { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
};

const compactDate = (value: string) =>
  formatDate(value, { day: '2-digit', month: 'short' }).replace(' ', ' ');

function LoadingPanel({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} aria-label="Loading data" />;
}

function EmptyState({ title, detail, icon: Icon }: { title: string; detail: string; icon: typeof Table2 }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center" data-testid="empty-state">
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-secondary text-primary">
        <Icon size={19} strokeWidth={1.7} />
      </div>
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}

function Sidebar({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing: boolean }) {
  const navItems = [
    { label: 'Market pulse', icon: Activity, target: 'overview' },
    { label: 'Index history', icon: BarChart3, target: 'history' },
    { label: 'Raw observations', icon: Table2, target: 'observations' },
  ];

  return (
    <aside className="hidden w-[252px] shrink-0 flex-col bg-sidebar px-5 py-6 text-sidebar-foreground lg:flex">
      <div className="flex items-center gap-3 px-2">
        <div className="relative flex size-9 items-center justify-center overflow-hidden rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
          <Plane size={18} strokeWidth={2.2} className="-rotate-12" />
          <span className="absolute bottom-1 left-1 h-1 w-1 rounded-full bg-sidebar-primary-foreground/70" />
        </div>
        <div>
          <p className="text-[15px] font-extrabold tracking-tight">FareIndex</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/55">India domestic</p>
        </div>
      </div>

      <div className="mt-14 px-2">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-sidebar-foreground/40">Workspace</p>
        <nav className="mt-3 space-y-1" aria-label="Dashboard sections">
          {navItems.map(({ label, icon: Icon, target }, index) => (
            <a
              href={`#${target}`}
              key={target}
              data-testid={`link-nav-${target}`}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                index === 0
                  ? 'bg-sidebar-accent text-sidebar-foreground'
                  : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'
              }`}
            >
              <Icon size={16} strokeWidth={index === 0 ? 2.1 : 1.7} />
              <span>{label}</span>
              {index === 0 && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}
            </a>
          ))}
        </nav>
      </div>

      <div className="mt-auto space-y-4">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold">
            <ShieldCheck size={14} className="text-sidebar-primary" />
            <span>Methodology is live</span>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-sidebar-foreground/55">
            A fixed basket of routes. A moving signal for what flying costs.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          data-testid="button-refresh-sidebar"
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50"
        >
          <span className="flex items-center gap-2"><RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} /> Refresh source</span>
          <span className="font-mono text-[10px]">⌘ R</span>
        </button>
      </div>
    </aside>
  );
}

function IndiaFlight() {
  return (
    <div className="relative min-h-[245px] overflow-hidden rounded-2xl border border-primary/10 bg-[#e9efe8]">
      <div className="absolute inset-0 opacity-55" style={{ backgroundImage: 'linear-gradient(hsl(203 54% 31% / .08) 1px, transparent 1px), linear-gradient(90deg, hsl(203 54% 31% / .08) 1px, transparent 1px)', backgroundSize: '34px 34px' }} />
      <div className="absolute left-5 top-5 z-10">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary/55">Live route context</span>
        <p className="mt-1 text-sm font-bold tracking-tight text-primary">India domestic network</p>
      </div>
      <svg viewBox="0 0 360 245" className="absolute inset-0 h-full w-full" aria-label="Animated flight path across India" role="img">
        <path d="M206 33 C238 43, 261 60, 272 78 C282 95, 275 112, 290 125 C305 138, 304 151, 287 164 C271 176, 273 196, 253 205 C238 212, 229 198, 218 186 C208 175, 188 173, 180 155 C171 138, 151 129, 144 112 C137 95, 150 84, 160 70 C171 55, 183 42, 206 33Z" fill="hsl(203 54% 31% / .11)" stroke="hsl(203 54% 31% / .27)" strokeWidth="1.2" />
        <path d="M159 102 C177 94, 195 80, 221 79 C245 78, 259 94, 276 113" fill="none" stroke="hsl(35 86% 60% / .95)" strokeWidth="2" className="flight-track" />
        <path d="M153 145 C180 128, 213 119, 258 148" fill="none" stroke="hsl(168 48% 38% / .85)" strokeWidth="1.5" strokeDasharray="3 7" />
        <g className="flight-plane" transform="translate(217 78)">
          <circle r="12" fill="hsl(35 86% 60% / .14)" className="india-pulse" />
          <path d="M-9 2 L7 -5 L3 1 L8 5 L6 7 L0 3 L-5 7 L-7 6 L-3 1Z" fill="hsl(203 54% 31%)" />
        </g>
        <circle cx="158" cy="102" r="4" fill="hsl(35 86% 60%)" stroke="hsl(42 40% 99%)" strokeWidth="2" />
        <circle cx="276" cy="113" r="4" fill="hsl(168 48% 38%)" stroke="hsl(42 40% 99%)" strokeWidth="2" />
        <circle cx="205" cy="151" r="3.5" fill="hsl(203 54% 31%)" stroke="hsl(42 40% 99%)" strokeWidth="2" />
        <text x="146" y="94" fill="hsl(203 54% 31%)" fontSize="8" fontFamily="Space Mono">DEL</text>
        <text x="280" y="111" fill="hsl(203 54% 31%)" fontSize="8" fontFamily="Space Mono">KOL</text>
        <text x="208" y="166" fill="hsl(203 54% 31%)" fontSize="8" fontFamily="Space Mono">BOM</text>
      </svg>
      <div className="absolute bottom-4 left-5 flex items-center gap-2 text-[10px] text-primary/60">
        <span className="size-1.5 rounded-full bg-accent" />
        <span>Sampled routes: DEL · BOM · BLR · HYD · MAA · CCU</span>
      </div>
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const indexQuery = useGetIndex();
  const rawQuery = useGetRawData();
  const scrapeMutation = useTriggerScrape();
  const [routeFilter, setRouteFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [runMessage, setRunMessage] = useState('');

  const indexData = indexQuery.data ?? [];
  const rawData = rawQuery.data ?? [];
  const latestPoint = indexData.find((point) => point.isLatest) ?? indexData[indexData.length - 1];
  const previousPoint = indexData.length > 1 ? indexData[indexData.length - 2] : undefined;
  const latestChange = latestPoint?.changePercent ?? (latestPoint && previousPoint ? ((latestPoint.indexValue / previousPoint.indexValue) - 1) * 100 : 0);
  const latestDate = latestPoint?.date ?? rawData[rawData.length - 1]?.date;

  const routes = useMemo(() => Array.from(new Set(rawData.map((row) => row.route))).sort(), [rawData]);
  const visibleRaw = useMemo(() => {
    const normalized = search.toLowerCase().trim();
    return rawData
      .filter((row) => routeFilter === 'all' || row.route === routeFilter)
      .filter((row) => !normalized || `${row.route} ${row.origin} ${row.destination}`.toLowerCase().includes(normalized))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [rawData, routeFilter, search]);

  const routeStats = useMemo(() => {
    const stats = new Map<string, { route: string; origin: string; destination: string; fare: number; baseFare: number; count: number }>();
    rawData.forEach((row) => {
      const current = stats.get(row.route) ?? { route: row.route, origin: row.origin, destination: row.destination, fare: 0, baseFare: 0, count: 0 };
      current.fare += row.fare;
      current.count += 1;
      if (row.isBase) current.baseFare = row.fare;
      stats.set(row.route, current);
    });
    return Array.from(stats.values()).map((item) => ({ ...item, average: item.fare / item.count, delta: item.baseFare ? ((item.fare / item.count / item.baseFare) - 1) * 100 : 0 })).sort((a, b) => b.delta - a.delta);
  }, [rawData]);

  const chartData = useMemo(() => [...indexData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()), [indexData]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetIndexQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetRawDataQueryKey() });
  };

  const exportCsv = () => {
    if (!rawData.length) return;
    const header = 'route,origin,destination,fare,date,bookingWindow,isBase';
    const rows = rawData.map((row) => [row.route, row.origin, row.destination, row.fare, row.date, row.bookingWindow, row.isBase].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fareindex-observations-${latestDate ?? 'export'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const triggerScrape = () => {
    setRunMessage('');
    scrapeMutation.mutate(undefined, {
      onSuccess: (result) => {
        const nextPoint: IndexPoint = { date: result.date, indexValue: result.indexValue, changePercent: latestPoint ? ((result.indexValue / latestPoint.indexValue) - 1) * 100 : 0, isLatest: true };
        queryClient.setQueryData<IndexPoint[]>(getGetIndexQueryKey(), (current) => [...(current ?? []).map((point) => ({ ...point, isLatest: false })).filter((point) => point.date !== result.date), nextPoint]);
        queryClient.setQueryData<FareObservation[]>(getGetRawDataQueryKey(), (current) => [...(current ?? []), ...result.observations]);
        void queryClient.invalidateQueries({ queryKey: getGetIndexQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetRawDataQueryKey() });
        setRunMessage(`${result.message} · ${formatDate(result.date)}`);
      },
      onError: () => setRunMessage('The source did not respond. Try the scrape again in a moment.'),
    });
  };

  const isLoading = indexQuery.isLoading || rawQuery.isLoading;
  const hasError = indexQuery.isError || rawQuery.isError;

  return (
    <div className="grain app-shell flex bg-background text-foreground">
      <Sidebar onRefresh={refresh} isRefreshing={indexQuery.isFetching || rawQuery.isFetching} />
      <main className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-border/80 px-5 py-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3 lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Plane size={16} className="-rotate-12" /></div>
            <span className="text-sm font-extrabold tracking-tight">FareIndex</span>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
            <span className="size-1.5 rounded-full bg-accent" />
            <span>Domestic airfares · India</span>
            <span className="text-border">/</span>
            <span>Analyst cockpit</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[10px] font-semibold text-secondary-foreground sm:flex"><Wifi size={12} /> Source healthy</span>
            <button type="button" onClick={refresh} disabled={indexQuery.isFetching || rawQuery.isFetching} data-testid="button-refresh-header" aria-label="Refresh source data" className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50">
              <RefreshCw size={15} className={indexQuery.isFetching || rawQuery.isFetching ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 pb-12 pt-7 sm:px-8 lg:px-10 lg:pt-10">
          <section id="overview" className="enter grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-accent/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary">FI / 01</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Daily signal</span>
              </div>
              <h1 className="mt-5 max-w-3xl text-[clamp(2.35rem,5.4vw,5rem)] font-extrabold leading-[0.97] tracking-[-0.075em] text-primary">
                What does it cost<br /><span className="text-accent">to fly across India?</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-[17px]">
                FareIndex turns route-level ticket observations into one clear read on domestic airfare inflation.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button type="button" onClick={triggerScrape} disabled={scrapeMutation.isPending} data-testid="button-trigger-scrape" className="group inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60">
                  <Sparkles size={15} className={scrapeMutation.isPending ? 'animate-pulse' : ''} />
                  {scrapeMutation.isPending ? 'Sampling routes…' : 'Run today’s scrape'}
                  <ArrowUpRight size={15} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </button>
                <button type="button" onClick={exportCsv} disabled={!rawData.length} data-testid="button-export-csv" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45">
                  <Download size={15} /> Export CSV
                </button>
              </div>
              {(runMessage || hasError) && (
                <div className={`mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${hasError && !runMessage.includes('·') ? 'bg-destructive/10 text-destructive' : 'bg-accent/15 text-primary'}`} data-testid="status-scrape">
                  {hasError && !runMessage.includes('·') ? <CircleHelp size={14} /> : <Check size={14} />}
                  {hasError && !runMessage.includes('·') ? (runMessage || 'Unable to load the source right now.') : runMessage}
                </div>
              )}
            </div>
            <div className="enter enter-delay-2"><IndiaFlight /></div>
          </section>

          <section className="enter enter-delay-1 mt-12 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Index summary">
            {isLoading ? <><LoadingPanel className="h-[126px]" /><LoadingPanel className="h-[126px]" /><LoadingPanel className="h-[126px]" /><LoadingPanel className="h-[126px]" /></> : (
              <>
                <div className="cockpit-card rounded-xl p-5" data-testid="metric-latest-index">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">FareIndex value</span><FileBarChart size={16} className="text-accent" /></div>
                  <div className="metric-value mt-3 text-[2.15rem] font-extrabold text-primary">{latestPoint ? latestPoint.indexValue.toFixed(1) : '—'}</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Base period = 100.0</p>
                </div>
                <div className="cockpit-card rounded-xl p-5" data-testid="metric-daily-change">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Latest movement</span>{latestChange >= 0 ? <TrendingUp size={16} className="text-accent" /> : <ArrowDownRight size={16} className="text-destructive" />}</div>
                  <div className={`metric-value mt-3 text-[2.15rem] font-extrabold ${latestChange >= 0 ? 'text-accent-foreground' : 'text-destructive'}`}>{latestPoint ? `${latestChange >= 0 ? '+' : ''}${latestChange.toFixed(2)}%` : '—'}</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">day over day</p>
                </div>
                <div className="cockpit-card rounded-xl p-5" data-testid="metric-observations">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Observations</span><Table2 size={16} className="text-primary/65" /></div>
                  <div className="metric-value mt-3 text-[2.15rem] font-extrabold text-primary">{rawData.length.toLocaleString('en-IN')}</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{routes.length} active routes in basket</p>
                </div>
                <div className="cockpit-card rounded-xl p-5" data-testid="metric-freshness">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Source freshness</span><Clock3 size={16} className="text-primary/65" /></div>
                  <div className="mt-3 text-lg font-extrabold tracking-tight text-primary">{latestDate ? formatDate(latestDate) : 'Waiting'}</div>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-accent" /> Reconciled daily at 06:00 IST</p>
                </div>
              </>
            )}
          </section>

          <section id="history" className="enter enter-delay-2 mt-8 grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
            <div className="cockpit-card rounded-2xl p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><div className="flex items-center gap-2"><BarChart3 size={16} className="text-accent" /><h2 className="text-sm font-extrabold text-primary">Index history</h2></div><p className="mt-1 text-xs text-muted-foreground">A fixed basket, observed day by day.</p></div>
                <span className="rounded-md bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground">{chartData.length ? `${compactDate(chartData[0].date)} — ${compactDate(chartData[chartData.length - 1].date)}` : 'No dates yet'}</span>
              </div>
              <div className="mt-7 h-[280px] w-full" data-testid="chart-index-history">
                {isLoading ? <LoadingPanel className="h-full w-full" /> : chartData.length < 2 ? <EmptyState title="Index history is warming up" detail="Run a scrape once the first route observations are available." icon={BarChart3} /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="hsl(39 22% 86% / .75)" strokeDasharray="3 5" />
                      <XAxis dataKey="date" tickFormatter={compactDate} tickLine={false} axisLine={false} tick={{ fill: 'hsl(205 17% 46%)', fontSize: 10, fontFamily: 'Space Mono' }} minTickGap={28} />
                      <YAxis domain={['auto', 'auto']} tickLine={false} axisLine={false} tick={{ fill: 'hsl(205 17% 46%)', fontSize: 10, fontFamily: 'Space Mono' }} width={38} />
                      <ReferenceLine y={100} stroke="hsl(205 17% 46% / .35)" strokeDasharray="4 4" label={{ value: 'BASE 100', fill: 'hsl(205 17% 46%)', fontSize: 9, position: 'insideTopRight' }} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid hsl(39 24% 88%)', background: 'hsl(42 40% 99%)', boxShadow: '0 8px 24px hsl(206 38% 18% / .1)', fontSize: 12 }} labelFormatter={(label) => formatDate(String(label))} formatter={(value) => [Number(value).toFixed(2), 'Index']} />
                      <Line type="monotone" dataKey="indexValue" stroke="hsl(203 54% 31%)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(35 86% 60%)', stroke: 'hsl(42 40% 99%)', strokeWidth: 2 }} activeDot={{ r: 5, fill: 'hsl(35 86% 60%)', stroke: 'hsl(203 54% 31%)', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="cockpit-card overflow-hidden rounded-2xl bg-primary text-primary-foreground">
              <div className="border-b border-primary-foreground/10 p-5 sm:p-6">
                <div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary-foreground/55">Signal note</span><Info size={15} className="text-accent" /></div>
                <p className="mt-5 text-[1.55rem] font-extrabold leading-[1.08] tracking-[-0.055em]">A ticket is a tiny receipt for the whole network.</p>
              </div>
              <div className="space-y-4 p-5 sm:p-6">
                <p className="text-sm leading-6 text-primary-foreground/65">We hold the route basket steady, then let prices move. The result is easier to trust than a single cheap or expensive fare.</p>
                <button type="button" onClick={() => setMethodologyOpen((open) => !open)} data-testid="button-open-methodology" className="flex items-center gap-2 text-xs font-bold text-accent transition-opacity hover:opacity-80">
                  {methodologyOpen ? 'Hide methodology' : 'Read the methodology'} <ChevronDown size={14} className={`transition-transform ${methodologyOpen ? 'rotate-180' : ''}`} />
                </button>
                {methodologyOpen && <div className="border-t border-primary-foreground/10 pt-4 text-xs leading-5 text-primary-foreground/65" data-testid="panel-methodology"><strong className="text-primary-foreground">Laspeyres base-period index.</strong> Each route’s base fare and weight stay fixed. The daily index asks: what would that same basket cost today? Base period is normalized to 100.0.</div>}
              </div>
            </div>
          </section>

          <section className="enter enter-delay-3 mt-8 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="cockpit-card rounded-2xl p-5 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><div className="flex items-center gap-2"><RouteIcon size={16} className="text-accent" /><h2 className="text-sm font-extrabold text-primary">Route pulse</h2></div><p className="mt-1 text-xs text-muted-foreground">Where the basket is feeling it most.</p></div>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{routeStats.length} routes tracked</span>
              </div>
              {isLoading ? <div className="mt-6 grid gap-2 sm:grid-cols-2"><LoadingPanel className="h-16" /><LoadingPanel className="h-16" /><LoadingPanel className="h-16" /><LoadingPanel className="h-16" /></div> : routeStats.length === 0 ? <EmptyState title="No route observations yet" detail="Your first scrape will populate the basket here." icon={RouteIcon} /> : (
                <div className="mt-6 grid gap-2 sm:grid-cols-2" data-testid="list-route-pulse">
                  {routeStats.slice(0, 6).map((route) => (
                    <button type="button" onClick={() => { setRouteFilter(route.route); document.getElementById('observations')?.scrollIntoView({ behavior: 'smooth' }); }} key={route.route} data-testid={`button-route-${route.route}`} className="group flex items-center justify-between rounded-xl border border-border/80 bg-background/55 px-4 py-3 text-left transition-colors hover:border-accent/50 hover:bg-secondary">
                      <div className="min-w-0"><p className="truncate text-xs font-extrabold text-primary">{route.origin} <span className="px-1 text-muted-foreground">→</span> {route.destination}</p><p className="mt-1 text-[10px] text-muted-foreground">{route.count} observations · avg {formatINR(route.average)}</p></div>
                      <span className={`ml-3 shrink-0 font-mono text-xs font-bold ${route.delta >= 0 ? 'text-accent-foreground' : 'text-destructive'}`}>{route.delta >= 0 ? '+' : ''}{route.delta.toFixed(1)}%</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="cockpit-card rounded-2xl p-5 sm:p-6">
              <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-accent" /><h2 className="text-sm font-extrabold text-primary">Signal integrity</h2></div>
              <div className="mt-6 space-y-5">
                {[['Fixed basket', 'Same routes, every day'], ['Base period', 'First observed fares'], ['Booking window', 'Comparable lead times']].map(([title, detail]) => <div className="flex gap-3" key={title}><div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-foreground"><Check size={12} strokeWidth={2.5} /></div><div><p className="text-xs font-bold text-primary">{title}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div></div>)}
              </div>
              <button type="button" onClick={() => setMethodologyOpen(true)} data-testid="button-learn-index" className="mt-7 inline-flex items-center gap-1.5 text-xs font-bold text-primary underline decoration-accent/70 underline-offset-4 hover:decoration-accent">How the index works <ArrowUpRight size={13} /></button>
            </div>
          </section>

          <section id="observations" className="enter enter-delay-4 cockpit-card mt-8 overflow-hidden rounded-2xl">
            <div className="flex flex-col gap-4 border-b border-border/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div><div className="flex items-center gap-2"><Table2 size={16} className="text-accent" /><h2 className="text-sm font-extrabold text-primary">Raw observations</h2></div><p className="mt-1 text-xs text-muted-foreground">The fares behind the signal, with base-period markers intact.</p></div>
              <div className="flex flex-wrap gap-2">
                <label className="relative flex items-center"><Search size={14} className="pointer-events-none absolute left-3 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-observations" aria-label="Search route observations" placeholder="Search route" className="h-9 w-36 rounded-lg border border-border bg-background pl-9 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-accent sm:w-44" /></label>
                <select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)} data-testid="select-route-filter" aria-label="Filter observations by route" className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none focus:border-accent"><option value="all">All routes</option>{routes.map((route) => <option value={route} key={route}>{route}</option>)}</select>
              </div>
            </div>
            {isLoading ? <div className="space-y-2 p-5"><LoadingPanel className="h-11" /><LoadingPanel className="h-11" /><LoadingPanel className="h-11" /></div> : visibleRaw.length === 0 ? <EmptyState title="No matching observations" detail={rawData.length ? 'Try another route or search term.' : 'Run today’s scrape to bring route-level fares into view.'} icon={Table2} /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-secondary/55 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"><tr><th className="px-5 py-3 font-normal">Route</th><th className="px-5 py-3 font-normal">Observed</th><th className="px-5 py-3 font-normal">Fare</th><th className="px-5 py-3 font-normal">Booking window</th><th className="px-5 py-3 text-right font-normal">Basis</th></tr></thead>
                  <tbody className="divide-y divide-border/70">
                    {visibleRaw.slice(0, 40).map((row) => <tr className="table-row" key={row.id} data-testid={`row-observation-${row.id}`}><td className="px-5 py-3.5"><div className="flex items-center gap-2.5"><div className="flex size-7 items-center justify-center rounded-md bg-secondary text-primary"><MapPin size={13} /></div><div><p className="font-bold text-primary">{row.route}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{row.origin} → {row.destination}</p></div></div></td><td className="px-5 py-3.5 text-muted-foreground">{formatDate(row.date)}</td><td className="px-5 py-3.5 font-mono font-bold tabular-nums text-primary">{formatINR(row.fare)}</td><td className="px-5 py-3.5 text-muted-foreground">{row.bookingWindow}</td><td className="px-5 py-3.5 text-right">{row.isBase ? <span className="rounded-full bg-accent/20 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wide text-accent-foreground">Base</span> : <span className="text-muted-foreground/50">—</span>}</td></tr>)}
                  </tbody>
                </table>
                {visibleRaw.length > 40 && <p className="border-t border-border/70 px-5 py-3 text-center text-[11px] text-muted-foreground">Showing 40 of {visibleRaw.length} matching observations · export CSV for the complete set</p>}
              </div>
            )}
          </section>

          <footer className="mt-8 flex flex-col gap-3 border-t border-border/80 pt-5 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>FareIndex is a directional public signal, not a quote for any individual itinerary.</p>
            <p className="font-mono tracking-[0.08em]">LAST SYNC · {latestDate ? formatDate(latestDate, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'} IST</p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Router() {
  return (
    <ErrorBoundary>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;