import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const location = searchParams.get('location')
  const latitude = searchParams.get('latitude')
  const longitude = searchParams.get('longitude')

  if (!location && (!latitude || !longitude)) {
    return NextResponse.json(
      { error: 'Please provide either location name or latitude/longitude coordinates' },
      { status: 400 }
    )
  }

  try {
    let geocodeData

    if (location) {
      // Use Google Maps Geocoding API for real geocoding
      const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY'
      const googleResponse = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${googleMapsApiKey}`
      )
      geocodeData = await googleResponse.json()

      if (!geocodeData.results || geocodeData.results.length === 0) {
        return NextResponse.json(
          { error: 'Location not found' },
          { status: 404 }
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
        confidence: 0.95 // High confidence for Google Maps data
      }
    } else {
      // Use coordinates to get location info
      const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY'
      const googleResponse = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${googleMapsApiKey}`
      )
      geocodeData = await googleResponse.json()

      if (!geocodeData.results || geocodeData.results.length === 0) {
        return NextResponse.json(
          { error: 'Coordinates not found' },
          { status: 404 }
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
        confidence: 0.95
      }
    }

    // Validate coordinates
    if (typeof geocodeData.latitude !== 'number' || typeof geocodeData.longitude !== 'number') {
      return NextResponse.json(
        { error: 'Invalid coordinates received from geocoding service' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: geocodeData,
      timestamp: new Date().toISOString(),
      source: 'google_maps',
      confidence: geocodeData.confidence || 0.95
    })

  } catch (error) {
    console.error('Geocoding error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch location data' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)

  if (!body || !body.location) {
    return NextResponse.json(
      { error: 'Location is required in request body' },
      { status: 400 }
    )
  }

  const { location, latitude, longitude } = body

  // Forward to GET handler
  const url = new URL(request.url)
  if (latitude && longitude) {
    url.searchParams.set('latitude', latitude)
    url.searchParams.set('longitude', longitude)
  } else {
    url.searchParams.set('location', location)
  }

  const newRequest = new NextRequest(url, {
    method: 'GET',
    headers: request.headers
  })

  return GET(newRequest)
}