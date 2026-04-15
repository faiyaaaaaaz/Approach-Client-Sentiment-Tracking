"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const RANGE_OPTIONS = [
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 3 Days", value: "last_3_days" },
  { label: "Last Week", value: "last_week" },
  { label: "Last 3 Weeks", value: "last_3_weeks" },
  { label: "Last Month", value: "last_month" },
  { label: "Custom", value: "custom" },
];

const summaryStats = [
  {
    label: "Audit Runs",
    value: "24",
    change: "+12.4%",
    tone: "violet",
    helper: "Total completed runs in selected range",
  },
  {
    label: "Conversations Analyzed",
    value: "1,284",
    change: "+8.9%",
    tone: "blue",
    helper: "All processed conversations across runs",
  },
  {
    label: "Approach Opportunities",
    value: "96",
    change: "+14.1%",
    tone: "gold",
    helper: "Cases where review opportunity could have been taken",
  },
  {
    label: "Positive Resolution Rate",
    value: "71.8%",
    change: "+4.6%",
    tone: "emerald",
    helper: "Resolved or favorable conversation outcomes",
  },
];

const reviewBreakdown = [
  { label: "Likely Positive Review", value: 312, color: "from-cyan-400/80 to-blue-500/80" },
  { label: "Highly Likely Positive Review", value: 188, color: "from-emerald-400/80 to-cyan-400/80" },
  { label: "Missed Opportunity", value: 96, color: "from-amber-300/80 to-yellow-500/80" },
  { label: "Likely Negative Review", value: 143, color: "from-fuchsia-400/80 to-violet-500/80" },
  { label: "Highly Likely Negative Review", value: 72, color: "from-rose-400/80 to-red-500/80" },
  { label: "Negative Outcome - No Review Request", value: 473, color: "from-slate-400/80 to-slate-600/80" },
];

const sentimentBreakdown = [
  { label: "Very Positive", value: 138 },
  { label: "Positive", value: 294 },
  { label: "Slightly Positive", value: 201 },
  { label: "Neutral", value: 256 },
  { label: "Slightly Negative", value: 139 },
  { label: "Negative", value: 171 },
  { label: "Very Negative", value: 85 },
];

const employeeTable = [
  {
    name: "Ariana Khan",
    team: "CEx",
    handled: 186,
    missed: 18,
    positive: 74,
    negative: 19,
    score: "High",
  },
  {
    name: "Rahim Sarker",
    team: "CEx",
    handled: 172,
    missed: 14,
    positive: 69,
    negative: 21,
    score: "High",
  },
  {
    name: "Nafisa Chowdhury",
    team: "CEx",
    handled: 149,
    missed: 22,
    positive: 58,
    negative: 25,
    score: "Medium",
  },
  {
    name: "Shihab Ahmed",
    team: "CEx",
    handled: 131,
    missed: 27,
    positive: 41,
    negative: 31,
    score: "Needs Attention",
  },
  {
    name: "Farzana Islam",
    team: "CEx",
    handled: 117,
    missed: 15,
    positive: 44,
    negative: 17,
    score: "High",
  },
];

const weeklyTrend = [
  { label: "Week 1", opportunities: 18, positive: 72, unresolved: 19 },
  { label: "Week 2", opportunities: 23, positive: 88, unresolved: 16 },
  { label: "Week 3", opportunities: 27, positive: 79, unresolved: 24 },
  { label: "Week 4", opportunities: 28, positive: 95, unresolved: 13 },
];

const conversations = [
  {
    id: "CNV-284910",
    employee: "Ariana Khan",
    reviewSentiment: "Missed Opportunity",
    clientSentiment: "Very Positive",
    resolution: "Resolved",
    status: "Opportunity",
    date: "2026-04-14",
  },
  {
    id: "CNV-284744",
    employee: "Rahim Sarker",
    reviewSentiment: "Likely Positive Review",
    clientSentiment: "Positive",
    resolution: "Resolved",
    status: "Healthy",
    date: "2026-04-14",
  },
  {
    id: "CNV-284622",
    employee: "Shihab Ahmed",
    reviewSentiment: "Highly Likely Negative Review",
    clientSentiment: "Very Negative",
    resolution: "Unresolved",
    status: "Risk",
    date: "2026-04-13",
  },
  {
    id: "CNV-284511",
    employee: "Nafisa Chowdhury",
    reviewSentiment: "Negative Outcome - No Review Request",
    clientSentiment: "Negative",
    resolution: "Pending",
    status: "Watch",
    date: "2026-04-13",
  },
  {
    id: "CNV-284301",
    employee: "Farzana Islam",
    reviewSentiment: "Highly Likely Positive Review",
    clientSentiment: "Very Positive",
    resolution: "Resolved",
    status: "Healthy",
    date: "2026-04-12",
  },
];

function getStatToneClasses(tone) {
  const map = {
    violet:
      "border-violet-400/20 bg-violet-500/10 text-violet-200 shadow-[0_0_30px_rgba(139,92,246,0.18)]",
    blue:
      "border-cyan-400/20 bg-cyan-500/10 text-cyan-200 shadow-[0_0_30px_rgba(34,211,238,0.14)]",
    gold:
      "border-amber-300/20 bg-amber-400/10 text-amber-100 shadow-[0_0_30px_rgba(251,191,36,0.14)]",
    emerald:
      "border-emerald-400/20 bg-emerald-500/10 text-emerald-200 shadow-[0_0_30px_rgba(16,185,129,0.14)]",
  };

  return map[tone] || map.violet;
}

function getBadgeClasses(value) {
  if (value === "Healthy") {
    return "border-emerald-400/20 bg-emerald-500/10 text-emerald-200";
  }
  if (value === "Opportunity") {
    return "border-amber-300/20 bg-amber-400/10 text-amber-100";
  }
  if (value === "Watch") {
    return "border-cyan-400/20 bg-cyan-500/10 text-cyan-200";
  }
  if (value === "Risk" || value === "Needs Attention") {
    return "border-rose-400/20 bg-rose-500/10 text-rose-200";
  }
  if (value === "High") {
    return "border-violet-400/20 bg-violet-500/10 text-violet-200";
  }
  if (value === "Medium") {
    return "border-blue-400/20 bg-blue-500/10 text-blue-200";
  }

  return "border-white/10 bg-white/5 text-slate-200";
}

function getDateRangeFromPreset(preset) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const format = (date) => {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, "0");
    const d = `${date.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  let start = new Date(end);

  if (preset === "yesterday") {
    start.setDate(end.getDate() - 1);
    return { start: format(start), end: format(start) };
  }

  if (preset === "last_3_days") {
    start.setDate(end.getDate() - 2);
    return { start: format(start), end: format(end) };
  }

  if (preset === "last_week") {
    start.setDate(end.getDate() - 6);
    return { start: format(start), end: format(end) };
  }

  if (preset === "last_3_weeks") {
    start.setDate(end.getDate() - 20);
    return { start: format(start), end: format(end) };
  }

  if (preset === "last_month") {
    start.setMonth(end.getMonth() - 1);
    start.setDate(end.getDate() + 1);
    return { start: format(start), end: format(end) };
  }

  return { start: format(end), end: format(end) };
}

export default function ResultsPage() {
  const initialRange = getDateRangeFromPreset("last_week");

  const [selectedRange, setSelectedRange] = useState("last_week");
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);

  const activeSummary = useMemo(() => {
    return `${startDate} to ${endDate}`;
  }, [startDate, endDate]);

  const handleRangeChange = (value) => {
    setSelectedRange(value);

    if (value !== "custom") {
      const nextRange = getDateRangeFromPreset(value);
      setStartDate(nextRange.start);
      setEndDate(nextRange.end);
    }
  };

  const totalReviews = reviewBreakdown.reduce((sum, item) => sum + item.value, 0);
  const maxTrendValue = Math.max(
    ...weeklyTrend.flatMap((item) => [item.opportunities, item.positive, item.unresolved])
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030614] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-15%] h-[26rem] w-[26rem] rounded-full bg-violet-600/18 blur-3xl" />
        <div className="absolute right-[-8%] top-[8%] h-[24rem] w-[24rem] rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute bottom-[-10%] left-[20%] h-[28rem] w-[28rem] rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(91,33,182,0.14),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(6,182,212,0.10),transparent_22%),linear-gradient(180deg,#050816_0%,#030614_48%,#02030a_100%)]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-8 md:px-8 lg:px-10">
        <section className="mb-8 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_30px_120px_rgba(2,6,23,0.65)] backdrop-blur-2xl">
          <div className="grid gap-8 px-6 py-7 md:px-8 lg:grid-cols-[1.4fr_0.9fr] lg:px-10 lg:py-10">
            <div>
              <div className="mb-4 inline-flex items-center rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-200">
                Premium Results Intelligence
              </div>

              <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-white md:text-5xl">
                Results & insights designed like an elite analytics command center
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
                Track review sentiment performance, client sentiment distribution,
                employee-level opportunities, and conversation-level audit signals
                through a high-clarity premium dashboard experience.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/run"
                  className="inline-flex items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(96,165,250,0.95),rgba(168,85,247,0.95),rgba(236,72,153,0.95))] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(147,51,234,0.28)] transition hover:scale-[1.01]"
                >
                  Run New Audit
                </Link>

                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                >
                  Export Results
                </button>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-[#081121]/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_60px_rgba(0,0,0,0.32)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Active Range</p>
                  <p className="mt-1 text-xs text-slate-400">{activeSummary}</p>
                </div>
                <div className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                  Live-ready shell
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Quick Range
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {RANGE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleRangeChange(option.value)}
                        className={`rounded-2xl border px-3 py-2.5 text-sm font-medium transition ${
                          selectedRange === option.value
                            ? "border-violet-400/40 bg-violet-500/15 text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.16)]"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/8"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setSelectedRange("custom");
                        setStartDate(e.target.value);
                      }}
                      className="w-full rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setSelectedRange("custom");
                        setEndDate(e.target.value);
                      }}
                      className="w-full rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-100">
                  This will later drive real Supabase queries for filtered runs,
                  employee analytics, and conversation drill-down.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryStats.map((stat) => (
            <div
              key={stat.label}
              className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-5 shadow-[0_20px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl"
            >
              <div
                className={`mb-4 inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getStatToneClasses(
                  stat.tone
                )}`}
              >
                {stat.change}
              </div>

              <p className="text-sm text-slate-400">{stat.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {stat.value}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{stat.helper}</p>
            </div>
          ))}
        </section>

        <section className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-white">
                  Review Sentiment Distribution
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  A premium breakdown of likely review outcomes across the selected
                  date range.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
                {totalReviews.toLocaleString()} total
              </div>
            </div>

            <div className="space-y-4">
              {reviewBreakdown.map((item) => {
                const percentage = totalReviews ? (item.value / totalReviews) * 100 : 0;

                return (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between gap-4">
                      <p className="text-sm font-medium text-slate-200">{item.label}</p>
                      <p className="text-sm text-slate-400">
                        {item.value} <span className="text-slate-500">({percentage.toFixed(1)}%)</span>
                      </p>
                    </div>
                    <div className="h-3 rounded-full bg-white/5">
                      <div
                        className={`h-3 rounded-full bg-gradient-to-r ${item.color} shadow-[0_0_20px_rgba(255,255,255,0.08)]`}
                        style={{ width: `${Math.max(percentage, 4)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                Client Sentiment Mix
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Overall emotional direction across analyzed customer conversations.
              </p>
            </div>

            <div className="space-y-3">
              {sentimentBreakdown.map((item) => {
                const maxValue = Math.max(...sentimentBreakdown.map((x) => x.value));
                const width = (item.value / maxValue) * 100;

                return (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-white/10 bg-[#081120] p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-200">{item.label}</p>
                      <p className="text-sm text-slate-400">{item.value}</p>
                    </div>
                    <div className="h-2.5 rounded-full bg-white/5">
                      <div
                        className="h-2.5 rounded-full bg-[linear-gradient(90deg,rgba(34,211,238,0.85),rgba(168,85,247,0.9),rgba(236,72,153,0.85))]"
                        style={{ width: `${Math.max(width, 8)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-white">
                  Employee Opportunity Intelligence
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Highlight team members with the strongest positive signals,
                  missed approach opportunities, and risk patterns.
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[22px] border border-white/10">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead className="bg-white/5">
                    <tr className="text-left">
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Employee
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Team
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Handled
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Missed
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Positive
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Negative
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Health
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeTable.map((employee, index) => (
                      <tr
                        key={employee.name}
                        className={`border-t border-white/10 ${
                          index % 2 === 0 ? "bg-white/[0.03]" : "bg-transparent"
                        }`}
                      >
                        <td className="px-4 py-4">
                          <div>
                            <p className="text-sm font-medium text-white">{employee.name}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              Review opportunity pattern tracking
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-300">{employee.team}</td>
                        <td className="px-4 py-4 text-sm text-slate-200">{employee.handled}</td>
                        <td className="px-4 py-4 text-sm text-amber-200">{employee.missed}</td>
                        <td className="px-4 py-4 text-sm text-emerald-200">{employee.positive}</td>
                        <td className="px-4 py-4 text-sm text-rose-200">{employee.negative}</td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getBadgeClasses(
                              employee.score
                            )}`}
                          >
                            {employee.score}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                Weekly Trend Signal
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                A fast view of opportunity volume, positive outcomes, and unresolved
                pressure over time.
              </p>
            </div>

            <div className="space-y-5">
              {weeklyTrend.map((week) => (
                <div key={week.label} className="rounded-2xl border border-white/10 bg-[#081120] p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm font-medium text-white">{week.label}</p>
                    <p className="text-xs text-slate-400">
                      Opportunity-focused trend snapshot
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                        <span>Approach Opportunities</span>
                        <span>{week.opportunities}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-white/5">
                        <div
                          className="h-2.5 rounded-full bg-[linear-gradient(90deg,rgba(251,191,36,0.95),rgba(245,158,11,0.85))]"
                          style={{ width: `${(week.opportunities / maxTrendValue) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                        <span>Positive Outcomes</span>
                        <span>{week.positive}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-white/5">
                        <div
                          className="h-2.5 rounded-full bg-[linear-gradient(90deg,rgba(16,185,129,0.95),rgba(34,211,238,0.8))]"
                          style={{ width: `${(week.positive / maxTrendValue) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                        <span>Unresolved Pressure</span>
                        <span>{week.unresolved}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-white/5">
                        <div
                          className="h-2.5 rounded-full bg-[linear-gradient(90deg,rgba(244,63,94,0.95),rgba(168,85,247,0.8))]"
                          style={{ width: `${(week.unresolved / maxTrendValue) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                Conversation-Level Results
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                This section is where individual audited conversations will be
                filterable, searchable, and ready for drill-down after we connect
                live Supabase results.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                type="text"
                placeholder="Search conversation ID or employee"
                className="rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
              />
              <select className="rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20">
                <option>All Review Sentiments</option>
                <option>Missed Opportunity</option>
                <option>Likely Positive Review</option>
                <option>Highly Likely Positive Review</option>
                <option>Likely Negative Review</option>
                <option>Highly Likely Negative Review</option>
                <option>Negative Outcome - No Review Request</option>
              </select>
              <select className="rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20">
                <option>All Status Types</option>
                <option>Healthy</option>
                <option>Opportunity</option>
                <option>Watch</option>
                <option>Risk</option>
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-[22px] border border-white/10">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead className="bg-white/5">
                  <tr className="text-left">
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Conversation
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Employee
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Review Sentiment
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Client Sentiment
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Resolution
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Status
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((item, index) => (
                    <tr
                      key={item.id}
                      className={`border-t border-white/10 transition hover:bg-white/[0.04] ${
                        index % 2 === 0 ? "bg-white/[0.02]" : "bg-transparent"
                      }`}
                    >
                      <td className="px-4 py-4">
                        <div>
                          <p className="text-sm font-medium text-white">{item.id}</p>
                          <p className="mt-1 text-xs text-slate-400">Conversation detail view later</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-200">{item.employee}</td>
                      <td className="px-4 py-4 text-sm text-slate-300">{item.reviewSentiment}</td>
                      <td className="px-4 py-4 text-sm text-slate-300">{item.clientSentiment}</td>
                      <td className="px-4 py-4 text-sm text-slate-300">{item.resolution}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getBadgeClasses(
                            item.status
                          )}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-400">{item.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
