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
  const q = searchParams.get('q')
  const latitude = searchParams.get('latitude')
  const longitude = searchParams.get('longitude')

  if (!q && (!latitude || !longitude)) {
    return NextResponse.json(
      { error: 'Please provide either search query or coordinates' },
      { status: 400, headers: corsHeaders }
    )
  }

  try {
    // Use Google Maps Places API for autocomplete suggestions (high accuracy)
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY'
    
    let placesData
    
    if (q) {
      // Forward geocode for search query
      const encodeQuery = encodeURIComponent(q)
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeQuery}&key=${googleMapsApiKey}`
      )
      placesData = await response.json()
      
      if (placesData.status !== 'OK') {
        return NextResponse.json(
          { error: 'Place search failed', details: placesData.status },
          { status: 400, headers: corsHeaders }
        )
      }
      
      // Convert predictions to coordinate data
      const predictions = placesData.predictions || []
      const processedPredictions = await Promise.all(
        predictions.slice(0, 5).map(async (prediction: any) => {
          const placeId = prediction.place_id
          if (placeId) {
            // Get detailed place information
            const detailsResponse = await fetch(
              `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${googleMapsApiKey}`
            )
            const detailsData = await detailsResponse.json()
            
            if (detailsData.result && detailsData.result.geometry) {
              const { lat, lng } = detailsData.result.geometry.location
              return {
                description: prediction.description,
                placeId: placeId,
                latitude: lat,
                longitude: lng,
                formatted_address: detailsData.result.formatted_address || prediction.description,
                types: detailsData.result.types || prediction.types || [],
                confidence: 0.9, // High confidence for Place API
                structured_formatting: prediction.structured_formatting
              }
            }
          }
          
          return {
            description: prediction.description,
            placeId: prediction.place_id,
            latitude: undefined,
            longitude: undefined,
            confidence: 0.3, // Lower confidence without coordinates
            structured_formatting: prediction.structured_formatting
          }
        })
      )
      
      placesData = processedPredictions
    } else if (latitude && longitude) {
      // Reverse geocode for coordinates
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${googleMapsApiKey}`
      )
      const geocodeData = await response.json()
      
      if (geocodeData.status !== 'OK') {
        return NextResponse.json(
          { error: 'Geocoding failed', details: geocodeData.status },
          { status: 400, headers: corsHeaders }
        )
      }
      
      const result = geocodeData.results[0]
      
      placesData = [{
        description: result.formatted_address,
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        formatted_address: result.formatted_address,
        types: result.types,
        place_id: result.place_id,
        confidence: 0.95,
        structured_formatting: {
          main_text: result.formatted_address,
          secondary_text: ''
        }
      }]
    }

    return NextResponse.json({
      success: true,
      data: placesData,
      timestamp: new Date().toISOString(),
      source: 'google_maps',
      count: placesData?.length || 0
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('Map suggestions API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch map suggestions' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    
    if (!body || !body.q) {
      return NextResponse.json(
        { error: 'Search query is required in request body' },
        { status: 400, headers: corsHeaders }
      )
    }
    
    // Forward to GET handler
    const url = new URL(request.url)
    url.searchParams.set('q', body.q)
    
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