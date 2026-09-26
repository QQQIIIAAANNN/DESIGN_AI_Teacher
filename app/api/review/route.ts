import { NextResponse } from "next/server";
import { getReviewProvider } from "@/lib/review-provider";
import { questionBankCatalog } from "@/data/question-bank";
import { generateSuggestion } from "@/lib/suggestion-provider";
import { retrieveKnowledge } from "@/lib/knowledge-retrieval";
import { loadQuestionDocument } from "@/lib/question-source";
import { normalizeConfirmedRegions } from "@/lib/review-grounding";
import { reviewAuthorizationError } from "@/lib/server-auth";
import { getKnowledgeImageDataUrl } from "@/lib/private-knowledge";
import { isPracticeQuestion } from "@/lib/practice-question";
import { isReviewScenarioId, normalizeReviewMinutes } from "@/lib/review-scenario";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const denied = await reviewAuthorizationError(request);
    if (denied) return denied;
    const formData = await request.formData();
    if (formData.get("action") === "knowledge-image") {
      const id = String(formData.get("id") || "").slice(0, 100);
      if (!/^(IMG|PV|PT)-[a-zA-Z0-9-]+$/.test(id)) {
        return NextResponse.json({ error: "無效的知識圖頁編號。" }, { status: 400 });
      }
      const dataUrl = await getKnowledgeImageDataUrl(id);
      return dataUrl ? NextResponse.json({ dataUrl })
        : NextResponse.json({ error: "知識圖頁無法讀取。" }, { status: 404 });
    }
    if (formData.get("action") === "suggestion") {
      return NextResponse.json(await generateSuggestion(formData));
    }
    if (formData.get("action") === "knowledge") {
      const query = String(formData.get("query") || "").slice(0, 12000);
      const examType = formData.get("examType") === "site_planning" ? "site_planning" : "design";
      const limit = Math.max(1, Math.min(24, Number(formData.get("limit")) || 14));
      const focusKeys = typeof formData.get("focusKeys") === "string"
        ? JSON.parse(String(formData.get("focusKeys"))) : [];
      return NextResponse.json({ knowledge: await retrieveKnowledge(query, examType, limit,
        Array.isArray(focusKeys) ? focusKeys.filter((key): key is string => typeof key === "string").slice(0, 8) : []) });
    }
    if (formData.get("action") === "question-document") {
      const upload = formData.get("questionPdf");
      const questionId = formData.get("questionId");
      return NextResponse.json({ document: await loadQuestionDocument(
        typeof questionId === "string" ? questionId : undefined,
        upload instanceof File ? upload : null
      ) });
    }
    const drawing = formData.get("drawing");

    if (!(drawing instanceof File)) {
      return NextResponse.json(
        { error: "缺少 drawing 圖片檔案。" },
        { status: 400 }
      );
    }

    if (!drawing.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "目前只接受圖片格式。" },
        { status: 415 }
      );
    }

    if (drawing.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "圖片超過 25 MB，請先縮小檔案。" },
        { status: 413 }
      );
    }

    const model = (formData.get("model") as string | null) || undefined;
    const intensity = (formData.get("intensity") as "gentle" | "standard" | "strict" | null) || undefined;
    const scenarioValue = formData.get("scenario");
    const scenario = isReviewScenarioId(scenarioValue) ? scenarioValue : "design_8h";
    const targetMinutes = normalizeReviewMinutes(formData.get("targetMinutes"), scenario);
    const practiceValue = formData.get("practiceQuestion");
    const parsedPractice = typeof practiceValue === "string" ? JSON.parse(practiceValue) as unknown : null;
    const practiceQuestion = isPracticeQuestion(parsedPractice) ? parsedPractice : null;
    const questionId = formData.get("questionId");
    const question = typeof questionId === "string"
      ? questionBankCatalog.find((entry) => entry.id === questionId)
      : undefined;
    const questionUpload = formData.get("questionPdf");
    const questionDocument = await loadQuestionDocument(
      question?.id,
      questionUpload instanceof File ? questionUpload : null
    );
    const observationOverrides = typeof formData.get("observationOverrides") === "string"
      ? JSON.parse(String(formData.get("observationOverrides"))) : undefined;
    const confirmedRegions = typeof formData.get("confirmedRegions") === "string"
      ? normalizeConfirmedRegions(JSON.parse(String(formData.get("confirmedRegions")))) : [];

    const provider = getReviewProvider();
    const result = await provider.reviewDrawing({
      file: drawing,
      model,
      intensity,
      scenario,
      targetMinutes,
      practiceQuestion: question || questionUpload instanceof File ? null : practiceQuestion,
      questionTitle: question ? `${question.year} 年 ${question.title}（${question.topic}）` : undefined,
      questionDocument,
      observationOverrides,
      confirmedRegions,
      examType: question?.category === "site_planning" || practiceQuestion?.category === "site_planning" ? "site_planning" : "design"
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Review API failed:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "審圖流程發生錯誤。" },
      { status: 502 }
    );
  }
}
