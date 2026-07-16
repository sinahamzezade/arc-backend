import { useEffect, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type NamedCount = { name: string; value: number };
type DayCount = { day: string; count: number };

type AiUsageTopUser = {
  userId: string;
  email: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type AiUsagePayload = {
  hasUsage: boolean;
  totals: {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  byPurpose: { name?: string; label: string; calls: number; totalTokens: number }[];
  topUsers: AiUsageTopUser[];
};

type AnalyticsPayload = {
  rangeDays: number;
  totals: {
    users: number;
    active: number;
    admins: number;
    lessonsCompleted: number;
    battles: number;
    referrals: number;
  };
  aiUsage: AiUsagePayload;
  charts: {
    signupsByDay: DayCount[];
    authProviders: NamedCount[];
    userStatus: NamedCount[];
    questionnaire: NamedCount[];
    lessonCompletions: DayCount[];
    xpByReason: NamedCount[];
    rankDistribution: NamedCount[];
    battlesByDay: DayCount[];
    referralFunnel: NamedCount[];
  };
};

const COLORS = [
  '#5B7C6E',
  '#C4785A',
  '#2A9D8F',
  '#1A2E28',
  '#D4A373',
  '#B42318',
  '#7C9A92',
  '#8B5E4B',
];

function shortDay(day: string) {
  return day.slice(5);
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

type HealthComponentStatus = 'up' | 'down' | 'optional' | 'unknown';

type HealthProbe = {
  key: string;
  label: string;
  status: HealthComponentStatus;
  detail?: string;
  latencyMs?: number;
};

type HealthSnapshot = {
  checkedAt: string;
  readiness: HealthProbe;
  liveness: HealthProbe;
  database: HealthProbe;
  redis: HealthProbe;
};

type TerminusPayload = {
  status?: string;
  info?: Record<string, { status?: string; optional?: boolean; message?: string }>;
  error?: Record<string, { status?: string; optional?: boolean; message?: string }>;
  details?: Record<string, { status?: string; optional?: boolean; message?: string }>;
};

function mergeTerminusDetails(payload: TerminusPayload | null) {
  return {
    ...(payload?.info ?? {}),
    ...(payload?.details ?? {}),
    ...(payload?.error ?? {}),
  };
}

function componentStatus(
  payload: TerminusPayload | null,
  key: string,
): HealthComponentStatus {
  const row = mergeTerminusDetails(payload)[key];
  if (!row) return 'unknown';
  if (row.optional && row.status !== 'down') return 'optional';
  if (row.status === 'up') return 'up';
  if (row.status === 'down') return 'down';
  return 'unknown';
}

function formatCheckedAt(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

async function fetchHealthSnapshot(): Promise<HealthSnapshot> {
  const [readinessRes, livenessRes] = await Promise.all([
    fetch('/health/readiness', { credentials: 'same-origin' }),
    fetch('/health/live', { credentials: 'same-origin' }),
  ]);

  const readinessStarted = performance.now();
  let readinessPayload: TerminusPayload | null = null;
  let livenessPayload: TerminusPayload | null = null;

  try {
    readinessPayload = (await readinessRes.json()) as TerminusPayload;
  } catch {
    readinessPayload = null;
  }
  try {
    livenessPayload = (await livenessRes.json()) as TerminusPayload;
  } catch {
    livenessPayload = null;
  }

  const readinessLatency = Math.round(performance.now() - readinessStarted);

  const readinessStatus: HealthComponentStatus = readinessRes.ok
    ? readinessPayload?.status === 'ok'
      ? 'up'
      : 'down'
    : 'down';

  const livenessStatus: HealthComponentStatus = livenessRes.ok
    ? livenessPayload?.status === 'ok'
      ? 'up'
      : 'down'
    : 'down';

  const dbStatus = componentStatus(readinessPayload, 'database');
  const redisStatus = componentStatus(readinessPayload, 'redis');
  const redisRow = mergeTerminusDetails(readinessPayload).redis;

  return {
    checkedAt: new Date().toISOString(),
    readiness: {
      key: 'readiness',
      label: 'Readiness',
      status: readinessStatus,
      detail: readinessStatus === 'up' ? 'Ready for traffic' : 'Not ready',
      latencyMs: readinessLatency,
    },
    liveness: {
      key: 'liveness',
      label: 'Liveness',
      status: livenessStatus,
      detail: livenessStatus === 'up' ? 'Process alive' : 'Process unhealthy',
    },
    database: {
      key: 'database',
      label: 'Database',
      status: dbStatus,
      detail:
        dbStatus === 'up'
          ? 'Postgres reachable'
          : mergeTerminusDetails(readinessPayload).database?.message ??
            'Unreachable',
    },
    redis: {
      key: 'redis',
      label: 'Redis',
      status: redisStatus,
      detail:
        redisStatus === 'optional'
          ? 'Not configured (optional)'
          : redisStatus === 'up'
            ? 'Connected'
            : redisRow?.message ?? 'Unreachable',
    },
  };
}

function HealthWidget({ probe }: { probe: HealthProbe }) {
  return (
    <div className={`health-widget status-${probe.status}`}>
      <div className="health-widget-head">
        <span className="health-dot" aria-hidden />
        <span className="health-label">{probe.label}</span>
      </div>
      <div className="health-status">
        {probe.status === 'up' && 'Healthy'}
        {probe.status === 'down' && 'Unhealthy'}
        {probe.status === 'optional' && 'Optional'}
        {probe.status === 'unknown' && 'Unknown'}
      </div>
      <p className="health-detail">{probe.detail}</p>
      {probe.latencyMs != null ? (
        <p className="health-latency">{probe.latencyMs} ms</p>
      ) : null}
    </div>
  );
}

function HealthSection() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const load = async () => {
      try {
        const snapshot = await fetchHealthSnapshot();
        if (!cancelled) {
          setHealth(snapshot);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Health check failed');
        }
      }
    };

    void load();
    timer = setInterval(() => {
      void load();
    }, 30_000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <section className="health-panel">
      <div className="health-panel-head">
        <div>
          <h3>System health</h3>
          <p className="hint">
            Live · readiness · dependencies · refreshes every 30s
          </p>
        </div>
        {health ? (
          <span className="health-checked-at">
            Checked {formatCheckedAt(health.checkedAt)}
          </span>
        ) : null}
      </div>

      {error ? <p className="health-error">{error}</p> : null}

      {!health && !error ? (
        <p className="health-loading">Checking health…</p>
      ) : null}

      {health ? (
        <div className="health-grid">
          <HealthWidget probe={health.readiness} />
          <HealthWidget probe={health.liveness} />
          <HealthWidget probe={health.database} />
          <HealthWidget probe={health.redis} />
        </div>
      ) : null}
    </section>
  );
}

function ChartCard({
  title,
  hint,
  span,
  children,
}: {
  title: string;
  hint: string;
  span: '4' | '6' | '8';
  children: ReactNode;
}) {
  return (
    <section className={`chart-card span-${span}`}>
      <h3>{title}</h3>
      <p className="hint">{hint}</p>
      <div style={{ width: '100%', height: 220 }}>{children}</div>
    </section>
  );
}

function AiUsageSection({ aiUsage }: { aiUsage: AiUsagePayload }) {
  const purposeData = aiUsage.byPurpose.map((row) => ({
    name: row.label,
    value: row.totalTokens,
    calls: row.calls,
  }));

  return (
    <section className="ai-usage-panel">
      <div className="ai-usage-head">
        <div>
          <h3>AI global usage</h3>
          <p className="hint">Metered across all users · all time</p>
        </div>
        <span className="ai-usage-badge">Calls · Tokens</span>
      </div>

      {!aiUsage.hasUsage ? (
        <p className="ai-usage-empty">No metered AI usage yet.</p>
      ) : (
        <>
          <div className="ai-kpi-row">
            <div className="kpi">
              <div className="label">Calls</div>
              <div className="value">{aiUsage.totals.calls}</div>
            </div>
            <div className="kpi">
              <div className="label">Prompt</div>
              <div className="value">{formatTokens(aiUsage.totals.promptTokens)}</div>
            </div>
            <div className="kpi">
              <div className="label">Completion</div>
              <div className="value">
                {formatTokens(aiUsage.totals.completionTokens)}
              </div>
            </div>
            <div className="kpi kpi-accent">
              <div className="label">Total tokens</div>
              <div className="value">
                {formatTokens(aiUsage.totals.totalTokens)}
              </div>
            </div>
          </div>

          <div className="ai-usage-body">
            <div className="ai-purpose-chart">
              <p className="ai-subhead">By feature</p>
              <div style={{ width: '100%', height: 200 }}>
                {purposeData.length === 0 ? (
                  <p className="ai-usage-empty">No feature breakdown.</p>
                ) : (
                  <ResponsiveContainer>
                    <BarChart
                      data={purposeData}
                      layout="vertical"
                      margin={{ left: 8, right: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#d5ddd7" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value, _name, item) => [
                          `${Number(value).toLocaleString()} tokens · ${item.payload.calls} calls`,
                          'Usage',
                        ]}
                      />
                      <Bar dataKey="value" fill="#5B7C6E" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="ai-top-users">
              <p className="ai-subhead">Top 5 users</p>
              {aiUsage.topUsers.length === 0 ? (
                <p className="ai-usage-empty">No per-user usage yet.</p>
              ) : (
                <table className="ai-top-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>User</th>
                      <th>Calls</th>
                      <th>Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiUsage.topUsers.map((row, i) => (
                      <tr key={row.userId}>
                        <td className="rank">{i + 1}</td>
                        <td>
                          <a href={`/admin/users/${row.userId}`}>{row.email}</a>
                        </td>
                        <td className="num">{row.calls}</td>
                        <td className="num strong">
                          {formatTokens(row.totalTokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function DashboardApp() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/admin/api/analytics', {
          credentials: 'same-origin',
        });
        if (!res.ok) {
          throw new Error(`Analytics failed (${res.status})`);
        }
        const json = (await res.json()) as AnalyticsPayload;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signups = data?.charts.signupsByDay.map((d) => ({
    ...d,
    label: shortDay(d.day),
  }));
  const lessons = data?.charts.lessonCompletions.map((d) => ({
    ...d,
    label: shortDay(d.day),
  }));

  return (
    <div>
      <HealthSection />

      {error ? <div className="dash-error">{error}</div> : null}
      {!data && !error ? (
        <div className="dash-loading">Loading analytics…</div>
      ) : null}

      {data ? (
        <>
      <div className="kpi-row">
        <div className="kpi">
          <div className="label">Users</div>
          <div className="value">{data.totals.users}</div>
        </div>
        <div className="kpi">
          <div className="label">Active</div>
          <div className="value">{data.totals.active}</div>
        </div>
        <div className="kpi">
          <div className="label">Admins</div>
          <div className="value">{data.totals.admins}</div>
        </div>
        <div className="kpi">
          <div className="label">Lessons done</div>
          <div className="value">{data.totals.lessonsCompleted}</div>
        </div>
        <div className="kpi">
          <div className="label">Battles</div>
          <div className="value">{data.totals.battles}</div>
        </div>
        <div className="kpi">
          <div className="label">Referrals</div>
          <div className="value">{data.totals.referrals}</div>
        </div>
      </div>

      <AiUsageSection aiUsage={data.aiUsage} />

      <div className="dash-grid">
        <ChartCard title="Signups" hint="New accounts · last 30 days" span="8">
          <ResponsiveContainer>
            <AreaChart data={signups}>
              <defs>
                <linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5B7C6E" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#5B7C6E" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#d5ddd7" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#1A2E28"
                fill="url(#signupFill)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Auth providers" hint="Signup method mix" span="4">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data.charts.authProviders}
                dataKey="value"
                nameKey="name"
                innerRadius={48}
                outerRadius={78}
                paddingAngle={2}
              >
                {data.charts.authProviders.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Account status" hint="Active vs suspended" span="4">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data.charts.userStatus}
                dataKey="value"
                nameKey="name"
                outerRadius={78}
              >
                {data.charts.userStatus.map((row, i) => (
                  <Cell
                    key={i}
                    fill={row.name === 'Active' ? '#2A9D8F' : '#C4785A'}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Questionnaire funnel"
          hint="Profile questionnaire status"
          span="8"
        >
          <ResponsiveContainer>
            <BarChart data={data.charts.questionnaire}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d5ddd7" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#5B7C6E" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Lesson completions"
          hint="Completed lessons · last 30 days"
          span="6"
        >
          <ResponsiveContainer>
            <LineChart data={lessons}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d5ddd7" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#C4785A"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="XP by source"
          hint="Lifetime XP granted · last 30 days"
          span="6"
        >
          <ResponsiveContainer>
            <BarChart
              data={data.charts.xpByReason}
              layout="vertical"
              margin={{ left: 24 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#d5ddd7" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={90}
                tick={{ fontSize: 11 }}
              />
              <Tooltip />
              <Bar dataKey="value" fill="#2A9D8F" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Rank distribution"
          hint="Users by current rank"
          span="6"
        >
          <ResponsiveContainer>
            <BarChart data={data.charts.rankDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d5ddd7" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={60}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#1A2E28" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Referral funnel"
          hint="Attribution pipeline status"
          span="6"
        >
          <ResponsiveContainer>
            <BarChart data={data.charts.referralFunnel}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d5ddd7" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#C4785A" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
        </>
      ) : null}
    </div>
  );
}
