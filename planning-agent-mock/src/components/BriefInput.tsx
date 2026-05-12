"use client";

import { useState } from "react";

const EXAMPLE_BRIEF =
  "Cosmetics brand, $400K, May–June, awareness KPI (video completion rate), Canada, 25–54 women, premium inventory, no UGC adjacencies.";

const EXTRACTED_FIELDS =
  "advertiser, budget, flight, KPI, goal, geo, audience, inventory constraint, exclusions, and channels in scope";

export function BriefInput({
  onSubmit,
}: {
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          Paste a campaign brief
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          The agent extracts structured fields, then drafts a media plan with SSP-direct
          as the default and DSPs only where they earn a seat.
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="e.g. Cosmetics brand, $400K, May–June, awareness/VCR KPI, Canada, 25–54 women, premium inventory, no UGC adjacencies."
        className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-900"
      />

      <p className="mt-2 text-xs text-zinc-600">
        The agent looks for: {EXTRACTED_FIELDS}.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={text.trim().length < 10}
          onClick={() => onSubmit(text.trim())}
          className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          Draft plan
        </button>
        <button
          type="button"
          onClick={() => setText(EXAMPLE_BRIEF)}
          className="text-sm text-zinc-700 underline underline-offset-4 hover:text-zinc-900"
        >
          Use the cosmetics example
        </button>
      </div>
    </div>
  );
}
