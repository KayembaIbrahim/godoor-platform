import { NextRequest, NextResponse } from "next/server";
import type { NextFetchEvent } from "next/server";

// Mock data store for shopping lists
const mockShoppingLists = new Map<string, any>();

/**
 * Get all shopping lists for the current user
 */
export async function GET(request: NextRequest) {
  // In a real app, this would query Supabase/PostgreSQL
  const lists = Array.from(mockShoppingLists.values());
  return NextResponse.json({ shoppingLists: lists });
}

/**
 * Create a new shopping list
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, items } = body;
    
    const listId = id || `list-${Date.now()}`;
    
    // Validate that we have at least 5 items (as per requirement)
    if (!items || items.length < 5) {
      return NextResponse.json(
        { error: "Shopping list must contain at least 5 items" },
        400
      );
    }
    
    const list = {
      id: listId,
      name: "GoDoor Shopping List",
      items,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    mockShoppingLists.set(listId, list);
    
    return NextResponse.json({
      success: true,
      data: list
    }, 201);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      400
    );
  }
}

/**
 * Get a specific shopping list by ID
 */
export async function GET_ID(request: NextRequest, { params }: { params: { id: string } }) {
  const list = mockShoppingLists.get(params.id);
  if (!list) {
    return NextResponse.json({ error: "Shopping list not found" }, 404);
  }
  return NextResponse.json({ shoppingList: list });
}

/**
 * Update a shopping list
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const list = mockShoppingLists.get(params.id);
    if (!list) {
      return NextResponse.json({ error: "Shopping list not found" }, 404);
    }
    
    const updatedList = { ...list, ...body };
    mockShoppingLists.set(params.id, updatedList);
    
    return NextResponse.json({ success: true, data: updatedList });
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      400
    );
  }
}

/**
 * Delete a shopping list
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  if (!mockShoppingLists.has(params.id)) {
    return NextResponse.json({ error: "Shopping list not found" }, 404);
  }
  
  mockShoppingLists.delete(params.id);
  return NextResponse.json({ success: true });
}
