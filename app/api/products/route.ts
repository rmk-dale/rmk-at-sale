import { NextResponse } from "next/server";
import { getPublicProducts } from "@/lib/models/product";

export async function GET() {
  try {
    const all = await getPublicProducts();
    return NextResponse.json(all);
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
