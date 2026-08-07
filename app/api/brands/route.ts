import { NextResponse } from "next/server";
import { getPublicBrands } from "@/lib/models/brand";

export async function GET() {
  try {
    const allBrands = await getPublicBrands();
    return NextResponse.json(allBrands);
  } catch (error) {
    console.error("Error fetching brands:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
