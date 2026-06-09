import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return NextResponse.json({ orders: [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return NextResponse.json({ order: body }, { status: 201 });
}
