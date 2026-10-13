import { NextRequest, NextResponse } from 'next/server'

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders
  })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData().catch(() => null)
    
    if (!formData) {
      return NextResponse.json(
        { error: 'No form data provided' },
        { status: 400, headers: corsHeaders }
      )
    }

    const file = formData.get('file') as File | null
    const uploadType = formData.get('type') as string || 'general'
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size exceeds 10MB limit' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Generate unique filename
    const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.name}`
    
    // For now, we'll simulate R2 upload by returning a mock response
    // In a real implementation, you would upload to R2 using the Cloudflare R2 binding
    const mockUploadResult = {
      success: true,
      fileName: fileName,
      originalName: file.name,
      size: file.size,
      type: file.type,
      uploadType: uploadType,
      url: `https://godoor-uploads.your-domain.com/${fileName}`, // Mock URL
      uploadedAt: new Date().toISOString(),
      uploadedBy: 'current-user', // In real implementation, get from auth
      metadata: {
        contentType: file.type,
        lastModified: file.lastModified
      }
    }

    return NextResponse.json(mockUploadResult, { headers: corsHeaders })

  } catch (error) {
    console.error('File upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500, headers: corsHeaders }
    )
  }
}