import { NextRequest, NextResponse } from 'next/server'

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const text = searchParams.get('text')
  const latitude = searchParams.get('latitude')
  const longitude = searchParams.get('longitude')

  if (!text && (!latitude || !longitude)) {
    return NextResponse.json(
      { error: 'Please provide either text query or coordinates' },
      { status: 400, headers: corsHeaders }
    )
  }

  try {
    // Use Google Maps Geocoding API for real geocoding (high accuracy)
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY'
    
    let geocodeData
    
    if (text) {
      const encodeText = encodeURIComponent(text)
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeText}&key=${googleMapsApiKey}`
      )
      geocodeData = await response.json()
      
      if (!geocodeData.results || geocodeData.results.length === 0) {
        return NextResponse.json(
          { error: 'Location not found' },
          { status: 404, headers: corsHeaders }
        )
      }
      
      const result = geocodeData.results[0]
      const { lat, lng } = result.geometry.location
      
      geocodeData = {
        location: result.formatted_address,
        latitude: lat,
        longitude: lng,
        accuracy: result.geometry.location_type || 'ROOFTOP',
        address_components: result.address_components,
        confidence: 0.95, // High confidence for Google Maps
        formatted_address: result.formatted_address,
        types: result.types,
        place_id: result.place_id
      }
    } else if (latitude && longitude) {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${googleMapsApiKey}`
      )
      geocodeData = await response.json()
      
      if (!geocodeData.results || geocodeData.results.length === 0) {
        return NextResponse.json(
          { error: 'Coordinates not found' },
          { status: 404, headers: corsHeaders }
        )
      }
      
      const result = geocodeData.results[0]
      const { lat, lng } = result.geometry.location
      
      geocodeData = {
        location: result.formatted_address,
        latitude: lat,
        longitude: lng,
        accuracy: result.geometry.location_type || 'ROOFTOP',
        address_components: result.address_components,
        confidence: 0.95,
        formatted_address: result.formatted_address,
        types: result.types,
        place_id: result.place_id
      }
    }

    return NextResponse.json({
      success: true,
      data: geocodeData,
      timestamp: new Date().toISOString(),
      source: 'google_maps',
      confidence: geocodeData?.confidence || 0.95
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('Geocoding API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch location data' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    
    if (!body || !body.text) {
      return NextResponse.json(
        { error: 'Text query is required in request body' },
        { status: 400, headers: corsHeaders }
      )
    }
    
    // Forward to GET handler
    const url = new URL(request.url)
    url.searchParams.set('text', body.text)
    
    const newRequest = new Request(url, {
      method: 'GET',
      headers: request.headers
    })
    
    return GET(newRequest)
    
  } catch (error) {
    console.error('POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}