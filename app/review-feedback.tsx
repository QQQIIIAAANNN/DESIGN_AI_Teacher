"use client";

import type {
  ReviewFeedbackDraft,
  ReviewFeedbackRecord,
  ReviewFeedbackVerdict,
  ReviewItem
} from "@/lib/review-schema";

export type FeedbackSaveState = {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
  record?: ReviewFeedbackRecord;
};

type Props = {
  issue: ReviewItem;
  draft: ReviewFeedbackDraft;
  saveState?: FeedbackSaveState;
  staticDemo: boolean;
  onReact: (verdict: Extract<ReviewFeedbackVerdict, "helpful" | "unhelpful">) => void;
};

const reactions: Array<{
  value: Extract<ReviewFeedbackVerdict, "helpful" | "unhelpful">;
  label: string;
}> = [
  { value: "helpful", label: "回應良好" },
  { value: "unhelpful", label: "回應不佳" }
];

const verdictLabels: Partial<Record<ReviewFeedbackVerdict, string>> = {
  correct: "判斷正確",
  partially_correct: "部分正確",
  misjudged: "誤判",
  wrong_location: "位置錯誤"
};

export default function ReviewFeedbackPanel({ issue, draft, saveState, staticDemo, onReact }: Props) {
  const selectedReaction = draft.verdict === "helpful" || draft.verdict === "unhelpful" ? draft.verdict : "";
  const savedReaction = saveState?.status === "saved" && selectedReaction;
  const accuracyLabel = draft.verdict ? verdictLabels[draft.verdict] : undefined;

  return <section className="issue-feedback" aria-label={issue.title + "的意見反應"}
    onClick={(event) => event.stopPropagation()}>
    <div className="issue-feedback-heading">
      <strong>這則意見有幫助嗎？</strong>
      {accuracyLabel && <span>已自動記錄：{accuracyLabel}</span>}
      {saveState?.status === "saving" && <span>正在記錄…</span>}
      {savedReaction && <span className="feedback-success">已記錄你的反應</span>}
      {saveState?.status === "error" && <span className="feedback-error" role="alert">{saveState.message}</span>}
      {staticDemo && <span>展示版不會保存回饋。</span>}
    </div>
    <div className="feedback-reactions" role="group" aria-label={issue.title + "的快速反應"}>
      {reactions.map((reaction) => {
        const selected = selectedReaction === reaction.value;
        return <button key={reaction.value} type="button" aria-pressed={selected}
          className={selected ? "selected" : ""}
          disabled={staticDemo || saveState?.status === "saving" ||
            Boolean(selected && saveState?.status === "saved")}
          onClick={() => onReact(reaction.value)}>
          <span aria-hidden="true">{reaction.value === "helpful" ? "👍" : "👎"}</span>
          {reaction.label}
        </button>;
      })}
    </div>
  </section>;
}