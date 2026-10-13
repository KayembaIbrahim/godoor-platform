import { NextRequest, NextResponse } from 'next/server'

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Mock database for user preferences
const userPreferencesDB = new Map()

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')
  const preferenceKey = searchParams.get('key')

  try {
    if (userId) {
      if (preferenceKey) {
        // Get specific preference for user
        const userPrefs = userPreferencesDB.get(userId) || {}
        const value = userPrefs[preferenceKey]
        
        return NextResponse.json({
          success: true,
          userId,
          key: preferenceKey,
          value
        }, { headers: corsHeaders })
      } else {
        // Get all preferences for user
        const userPrefs = userPreferencesDB.get(userId) || {}
        return NextResponse.json({
          success: true,
          userId,
          preferences: userPrefs
        }, { headers: corsHeaders })
      }
    }

    // Get all preferences (if no userId specified - admin functionality)
    const allPreferences = Array.from(userPreferencesDB.entries())
    return NextResponse.json({
      success: true,
      data: allPreferences,
      count: allPreferences.length
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('GET user preferences error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user preferences' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    
    if (!body || !body.userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const userId = body.userId
    const preferences = body.preferences || body

    // Get existing preferences or create new
    const existingPrefs = userPreferencesDB.get(userId) || {}
    const updatedPrefs = { ...existingPrefs, ...preferences }

    userPreferencesDB.set(userId, updatedPrefs)

    return NextResponse.json({
      success: true,
      userId,
      preferences: updatedPrefs,
      message: 'User preferences updated successfully'
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('POST user preferences error:', error)
    return NextResponse.json(
      { error: 'Failed to update user preferences' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const preferenceKey = searchParams.get('key')
    
    if (!userId || !preferenceKey) {
      return NextResponse.json(
        { error: 'userId and key are required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const body = await request.json().catch(() => null)
    
    if (!body || body.value === undefined) {
      return NextResponse.json(
        { error: 'value is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const existingPrefs = userPreferencesDB.get(userId) || {}
    existingPrefs[preferenceKey] = body.value

    userPreferencesDB.set(userId, existingPrefs)

    return NextResponse.json({
      success: true,
      userId,
      key: preferenceKey,
      value: body.value,
      preferences: existingPrefs,
      message: 'User preference updated successfully'
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('PUT user preferences error:', error)
    return NextResponse.json(
      { error: 'Failed to update user preference' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const preferenceKey = searchParams.get('key')
    
    if (!userId || !preferenceKey) {
      return NextResponse.json(
        { error: 'userId and key are required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const existingPrefs = userPreferencesDB.get(userId)
    if (!existingPrefs || !(preferenceKey in existingPrefs)) {
      return NextResponse.json(
        { error: 'User preference not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    delete existingPrefs[preferenceKey]
    userPreferencesDB.set(userId, existingPrefs)

    return NextResponse.json({
      success: true,
      userId,
      key: preferenceKey,
      message: 'User preference deleted successfully'
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('DELETE user preferences error:', error)
    return NextResponse.json(
      { error: 'Failed to delete user preference' },
      { status: 500, headers: corsHeaders }
    )
  }
}