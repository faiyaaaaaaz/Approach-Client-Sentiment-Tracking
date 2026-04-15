import Link from "next/link";

export const metadata = {
  title: "Results | Review Approach & Client Sentiment Tracking",
};

export default function ResultsPage() {
  const summaryCards = [
    { label: "Total Runs", value: "0" },
    { label: "Processed Conversations", value: "0" },
    { label: "Positive Review Likelihood", value: "0" },
    { label: "Negative Review Likelihood", value: "0" },
  ];

  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <div className="mx-auto w-full max-w-7xl px-6 py-8 md:px-8 lg:px-10">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 inline-flex w-fit items-center rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-violet-200">
              Audit Results
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Results
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
              This page will hold saved audit runs, conversation-level verdicts,
              and historical review sentiment results once the backend save flow
              is connected.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/run"
              className="inline-flex items-center justify-center rounded-xl border border-violet-400/30 bg-violet-500/15 px-4 py-2.5 text-sm font-medium text-violet-100 transition hover:border-violet-300/50 hover:bg-violet-500/25"
            >
              Go to Run Audit
            </Link>
          </div>
        </div>

        <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_10px_40px_rgba(76,29,149,0.18)] backdrop-blur-xl"
            >
              <p className="text-sm text-slate-400">{card.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {card.value}
              </p>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_24px_80px_rgba(15,23,42,0.45)] backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-white">
                  Saved Audit Runs
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Your completed audit sessions will appear here.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-dashed border-white/10 bg-[#071122]/70 p-10 text-center">
              <div className="mx-auto max-w-xl">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-500/10 text-violet-200">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 6.75C4 5.7835 4.7835 5 5.75 5H18.25C19.2165 5 20 5.7835 20 6.75V17.25C20 18.2165 19.2165 19 18.25 19H5.75C4.7835 19 4 18.2165 4 17.25V6.75Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M8 10H16"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M8 14H13"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

                <h3 className="text-lg font-semibold text-white">
                  No results yet
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Once we connect the backend audit run flow and save results to
                  Supabase, this area will show each run with date, status,
                  totals, and quick access to conversation-level output.
                </p>

                <div className="mt-6">
                  <Link
                    href="/run"
                    className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
                  >
                    Start from Run Audit
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_24px_80px_rgba(15,23,42,0.35)] backdrop-blur-xl">
            <h2 className="text-xl font-semibold tracking-tight text-white">
              What will show here later
            </h2>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-[#081120] p-4">
                <p className="text-sm font-medium text-white">Run history</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Date, initiated by, conversations processed, and completion
                  status.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#081120] p-4">
                <p className="text-sm font-medium text-white">
                  Result breakdown
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Review sentiment, client sentiment, and final verdict
                  distribution.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#081120] p-4">
                <p className="text-sm font-medium text-white">
                  Conversation detail view
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Individual conversation IDs, outputs, and any saved metadata.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#081120] p-4">
                <p className="text-sm font-medium text-white">Filters</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Filter by run date, status, sentiment class, and reviewer.
                </p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
