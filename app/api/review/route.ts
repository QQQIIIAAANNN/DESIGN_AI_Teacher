import { NextResponse } from "next/server";
import { getReviewProvider } from "@/lib/review-provider";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
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

    const provider = getReviewProvider();
    const result = await provider.reviewDrawing({ file: drawing });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Review API failed:", error);

    return NextResponse.json(
      { error: "審圖流程發生錯誤。" },
      { status: 500 }
    );
  }
}
