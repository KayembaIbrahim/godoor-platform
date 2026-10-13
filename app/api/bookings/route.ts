import { NextRequest, NextResponse } from 'next/server'

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Mock database for bookings
const bookingsDB = new Map()

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bookingId = searchParams.get('id')
  const userId = searchParams.get('userId')
  const businessId = searchParams.get('businessId')

  try {
    if (bookingId) {
      const booking = bookingsDB.get(bookingId)
      if (!booking) {
        return NextResponse.json(
          { error: 'Booking not found' },
          { status: 404, headers: corsHeaders }
        )
      }
      return NextResponse.json({
        success: true,
        data: booking
      }, { headers: corsHeaders })
    }

    // Filter bookings by user or business
    let filteredBookings = Array.from(bookingsDB.values())
    
    if (userId) {
      filteredBookings = filteredBookings.filter(booking => booking.userId === userId)
    }
    
    if (businessId) {
      filteredBookings = filteredBookings.filter(booking => booking.businessId === businessId)
    }

    return NextResponse.json({
      success: true,
      data: filteredBookings,
      count: filteredBookings.length
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('GET bookings error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch bookings' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    
    if (!body || !body.userId || !body.businessId) {
      return NextResponse.json(
        { error: 'userId and businessId are required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const booking = {
      id: bookingId,
      userId: body.userId,
      businessId: body.businessId,
      service: body.service || 'General Service',
      date: body.date || new Date().toISOString(),
      time: body.time || '10:00',
      status: 'confirmed',
      paymentStatus: 'paid',
      totalAmount: body.totalAmount || 1500,
      currency: body.currency || 'UGX',
      contactNumber: body.contactNumber || '+256123456789',
      notes: body.notes || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    bookingsDB.set(bookingId, booking)

    return NextResponse.json({
      success: true,
      data: booking,
      message: 'Booking created successfully'
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('POST booking error:', error)
    return NextResponse.json(
      { error: 'Failed to create booking' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const bookingId = searchParams.get('id')
    
    if (!bookingId) {
      return NextResponse.json(
        { error: 'Booking ID is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const body = await request.json().catch(() => null)
    
    const existingBooking = bookingsDB.get(bookingId)
    if (!existingBooking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    const updatedBooking = {
      ...existingBooking,
      ...body,
      updatedAt: new Date().toISOString()
    }

    bookingsDB.set(bookingId, updatedBooking)

    return NextResponse.json({
      success: true,
      data: updatedBooking,
      message: 'Booking updated successfully'
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('PUT booking error:', error)
    return NextResponse.json(
      { error: 'Failed to update booking' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const bookingId = searchParams.get('id')
    
    if (!bookingId) {
      return NextResponse.json(
        { error: 'Booking ID is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const existingBooking = bookingsDB.get(bookingId)
    if (!existingBooking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    bookingsDB.delete(bookingId)

    return NextResponse.json({
      success: true,
      message: 'Booking deleted successfully'
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('DELETE booking error:', error)
    return NextResponse.json(
      { error: 'Failed to delete booking' },
      { status: 500, headers: corsHeaders }
    )
  }
}