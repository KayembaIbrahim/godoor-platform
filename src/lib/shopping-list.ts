import { useEffect, useState } from "react";

// Types for shopping list items
interface ShoppingItem {
  productId: string;
  merchantId: string;
  name: string;
  unitPriceUgx: number; // Must be 500 UGX per item as per requirement
  quantity: number;
}

interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingItem[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Shopping List component - displays and manages a shopping list
 */
export function ShoppingListPage() {
  const [list, setList] = useState<ShoppingList | null>(null);
  const [newItems, setNewItems] = useState<ShoppingItem[]>([]);
  const [name, setName] = useState("");
  const [count, setCount] = useState(0);

  // Load shopping list from API
  useEffect(() => {
    fetch("/api/shopping-list")
      .then(res => res.json())
      .then(data => {
        if (data.shoppingLists && data.shoppingLists.length > 0) {
          setList(data.shoppingLists[0]);
        }
      });
  }, []);

  // Handle adding a new item to the shopping list
  const handleAddItem = () => {
    if (!name.trim()) return;
    
    const item: ShoppingItem = {
      productId: "product-001", // placeholder product ID
      merchantId: "merchant-001",
      name: name.trim(),
      unitPriceUgx: 500, // Required: 500 UGX per item
      quantity: 1
    };
    
    setNewItems([...newItems, item]);
    setName("");
    setCount(newItems.length + 1);
  };

  // Handle removing an item
  const removeItem = (index: number) => {
    const updated = [...newItems];
    updated.splice(index, 1);
    setNewItems(updated);
  };

  // Calculate total price
  const totalPrice = list ? list.items.reduce((sum, item) => sum + (item.unitPriceUgx * item.quantity), 0) : 0;

  if (!list) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Shopping List</h1>
        <p>No shopping list found. Use the "Create New List" button to get started.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-center mb-8">Shopping List</h1>
      
      {/* Add new list form */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-8">
        <h2 className="font-semibold mb-4">Create New Shopping List</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Enter list name..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAddItem}
            disabled={!name.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Item
          </button>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          Each item costs 500 UGX. You need at least 5 items.
        </p>
      </div>

      {/* Shopping list display */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="font-semibold mb-4">Your Shopping List</h2>
        
        {list?.items.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No items in your list yet.</p>
        ) : (
          <div className="space-y-4">
            {list.items.map((item, index) => (
              <div key={index} className="flex justify-between items-center p-3 border rounded-lg">
                <div className="flex items-center">
                  <span className="text-lg font-medium">{item.name}</span>
                  <span className="text-xs text-blue-500">{item.unitPriceUgx} UGX × {item.quantity} = {item.unitPriceUgx * item.quantity} UGX</span>
                </div>
                <button
                  onClick={() => removeItem(index)}
                  className="text-red-500 hover:text-red-700 font-medium"
                >
                  Remove
                </button>
              </div>
            ))}
            
            <div className="flex justify-between mt-4 pt-4 border-t">
              <span className="text-lg font-bold">Total: {totalPrice} UGX</span>
              <button
                onClick={() => alert(`Order placed: ${totalPrice} UGX`)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Place Order
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
