"use client"

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShoppingItem, ShoppingList } from "@/lib/shopping-list";

export default function ShoppingListPage() {
  const [list, setList] = useState<ShoppingList | null>(null);
  const [newItems, setNewItems] = useState<ShoppingItem[]>([]);
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Load shopping list from API
  useEffect(() => {
    const fetchShoppingList = async () => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/shopping-list");
        
        if (!response.ok) {
          throw new Error("Failed to fetch shopping list");
        }
        
        const data = await response.json();
        if (data.shoppingLists && data.shoppingLists.length > 0) {
          setList(data.shoppingLists[0]);
        } else {
          setList(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchShoppingList();
  }, []);

  // Handle adding a new item to the shopping list
  const handleAddItem = async () => {
    if (!name.trim()) return;
    
    const item: ShoppingItem = {
      productId: `product-${Date.now()}`, // Unique product ID
      merchantId: "merchant-001", // Default merchant
      name: name.trim(),
      unitPriceUgx: 500, // Required: 500 UGX per item
      quantity: 1
    };
    
    setNewItems([...newItems, item]);
    setName("");
  };

  // Handle removing an item
  const removeItem = (index: number) => {
    const updated = [...newItems];
    updated.splice(index, 1);
    setNewItems(updated);
  };

  // Handle creating the shopping list with new items
  const handleCreateList = async () => {
    if (newItems.length < 5) {
      setError("Shopping list must contain at least 5 items");
      return;
    }
    
    try {
      const response = await fetch("/api/shopping-list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: `list-${Date.now()}`, // Generate unique ID
          items: newItems
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create shopping list");
      }
      
      const data = await response.json();
      setList(data.data);
      setNewItems([]);
      
      // Show success message
      alert(`Shopping list created successfully! Total: ${500 * newItems.length} UGX`);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shopping list");
    }
  };

  // Calculate total price
  const calculateTotalPrice = () => {
    return newItems.reduce((total, item) => total + (item.unitPriceUgx * item.quantity), 0);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading shopping list...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Shopping List</h1>
          <p className="text-gray-600">Create your shopping list with at least 5 items</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Add New Items Section */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Add Items</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Item Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter item name..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <button
                onClick={handleAddItem}
                disabled={!name.trim()}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Add Item
              </button>
            </div>
            
            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> Each item costs 500 UGX. You need at least 5 items to create a list.
              </p>
            </div>
          </div>

          {/* Current Items Section */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Current Items</h2>
            
            {newItems.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No items added yet.</p>
            ) : (
              <div className="space-y-3">
                {newItems.map((item, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-sm text-gray-600 ml-2">
                        (500 UGX × {item.quantity}) = {item.unitPriceUgx * item.quantity} UGX
                      </span>
                    </div>
                    <button
                      onClick={() => removeItem(index)}
                      className="text-red-600 hover:text-red-800 font-medium text-sm"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                
                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-lg font-semibold">Total:</span>
                    <span className="text-xl font-bold text-blue-600">
                      {calculateTotalPrice()} UGX
                    </span>
                  </div>
                  
                  <button
                    onClick={handleCreateList}
                    disabled={newItems.length < 5}
                    className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors"
                  >
                    Create Shopping List ({newItems.length} items)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Existing List Section */}
        {list && (
          <div className="mt-8 bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Your Existing Shopping List</h2>
            
            <div className="space-y-4">
              {list.items.map((item, index) => (
                <div key={index} className="flex justify-between items-center p-3 border rounded-lg">
                  <div>
                    <span className="font-medium">{item.name}</span>
                    <span className="text-sm text-gray-600 ml-2">
                      (500 UGX × {item.quantity}) = {item.unitPriceUgx * item.quantity} UGX
                    </span>
                  </div>
                </div>
              ))}
              
              <div className="pt-4 border-t">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">Total:</span>
                  <span className="text-xl font-bold text-green-600">
                    {list.items.reduce((sum, item) => sum + (item.unitPriceUgx * item.quantity), 0)} UGX
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}