import { NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const tenant = request.cookies.get('tenant')?.value
  if (!tenant) {
    return NextResponse.redirect('/tenant/select')
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/tenant/:path*'],
}
