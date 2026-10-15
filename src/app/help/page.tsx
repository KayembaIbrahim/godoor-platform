"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Headphones, MessageCircle, Mail, Phone, ChevronDown, ArrowLeft, Shield, FileText, AlertTriangle, ChevronUp, X, Upload, Image, Circle, Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { getApiUser } from "@/lib/api-auth";
import { v4 as uuidv4 } from "uuid";

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: "customer" | "support" | "system";
  message_type: "text" | "image";
  content: string;
  attachment_url: string | null;
  attachment_metadata: string | null;
  is_from_support: boolean;
  created_at: string;
}

interface Conversation {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  status: "open" | "awaiting_support" | "awaiting_user" | "resolved" | "closed";
  created_at: string;
  updated_at: string;
  last_message_at: string;
  latest_message: {
    id: string;
    created_at: string;
    sender_id: string;
    message_type: string;
    content: string;
  } | null;
}

// Premium 3D Avatar Component inspired by the reference images with cinematic lighting
function SupportAvatar() {
  return (
    <div className="relative w-32 h-32 mb-8">
      {/* Deep 3D character showcase container with atmospheric lighting */}
      <div className="relative w-full h-full">
        {/* Central lighting core - creates depth and atmosphere */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-600 via-green-500 to-purple-700 animate-[pulse_5s_ease_in_out_infinite]">
          <div className="absolute inset-0 rounded-full bg-black/40 animate-[gradient_8s_ease_in_out_infinite]" style={{
            background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.1) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(255,255,255,0.08) 0%, transparent 60%)'
          }}></div>
        </div>
        
        {/* Character 1 - Left - Enhanced 3D with multiple layers and reflections */}
        <div className="absolute left-0 top-1/4 transform -rotate-20 -translate-x-8 -translate-y-4">
          <div className="w-24 h-24 relative">
            {/* Character core with gradient layers */}
            <div className="w-full h-full rounded-full bg-gradient-to-br from-purple-400 via-purple-500 to-purple-600 shadow-[0_0_30px_rgba(147,51,234,0.4)] border-2 border-purple-300/30 relative overflow-hidden">
              {/* Inner glow effect */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/20 to-transparent" />
              {/* 3D highlight reflection */}
              <div className="absolute top-2 left-2 w-4 h-4 bg-white/40 rounded-full blur-sm" />
              {/* Orbital ring for depth */}
              <div className="absolute inset-0 rounded-full border border-purple-300/20 animate-[rotate_3s_linear_infinite]" style={{ transform: 'scale(1.2)' }} />
            </div>
            
            {/* Orbiting element for motion */}
            <div className="absolute inset-0 animate-[orbit_5s_linear_infinite]">
              <div className="absolute top-0 w-2 h-2 bg-purple-300/60 rounded-full" />
            </div>
          </div>
        </div>
        
        {/* Character 2 - Center - Main hero with enhanced glow and atmosphere */}
        <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <div className="relative w-28 h-28">
            {/* Central core with complex gradient and multiple glow effects */}
            <div className="w-full h-full rounded-full bg-gradient-to-br from-green-400 via-green-500 to-emerald-600 shadow-[0_0_40px_rgba(16,185,129,0.5),inset_0_0_30px_rgba(255,255,255,0.2)] border-2 border-green-300/40 relative overflow-hidden">
              {/* Advanced lighting layers */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-tl from-white/30 via-transparent to-green-400/20" />
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-transparent via-green-300/10 to-emerald-500/30" />
              {/* Central bright spot */}
              <div className="absolute top-4 left-6 w-3 h-3 bg-white/50 rounded-full blur-sm" />
              <div className="absolute bottom-4 right-6 w-4 h-4 bg-white/30 rounded-full blur-sm" />
              {/* Atmospheric glow */}
              <div className="absolute inset-0 rounded-full bg-green-400/20 animate-[pulse_3s_ease_in_out_infinite]" />
            </div>
            
            {/* Character icon with enhanced styling */}
            <div className="absolute inset-0 flex items-center justify-center">
              <MessageCircle className="w-16 h-16 text-white/90 filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)]" strokeWidth={1.5} />
            </div>
            
            {/* Orbiting particles around center character */}
            <div className="absolute inset-0 animate-[orbit_6s_linear_infinite_reverse]">
              <div className="absolute top-0 w-1.5 h-1.5 bg-green-300/70 rounded-full left-1/2 transform -translate-x-1/2" />
              <div className="absolute bottom-0 w-1.5 h-1.5 bg-emerald-300/70 rounded-full left-1/2 transform -translate-x-1/2" />
            </div>
          </div>
        </div>
        
        {/* Character 3 - Right - Distinctive style with unique lighting */}
        <div className="absolute right-0 top/3 transform rotate-20 translate-x-8 translate-y-4">
          <div className="w-20 h-20 relative">
            {/* Character core with unique gradient */}
            <div className="w-full h-full rounded-full bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 shadow-[0_0_30px_rgba(20,184,163,0.4)] border-2 border-emerald-300/30 relative overflow-hidden">
              {/* Distinctive lighting approach */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-bl from-white/25 to-transparent" />
              <div className="absolute top-2 right-2 w-2 h-2 bg-white/35 rounded-full" />
              {/* Surface texture */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-t from-emerald-600/20 to-transparent" />
            </div>
            
            {/* Character icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Headphones className="w-11 h-11 text-white/90 filter drop-shadow-[0_3px_6px_rgba(0,0,0,0.3)]" strokeWidth={1.5} />
            </div>
            
            {/* Orbiting elements */}
            <div className="absolute inset-0 animate-[orbit_4s_linear_infinite]">
              <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-8 h-8 border border-emerald-300/30 rounded-full" />
              <div className="absolute left-1/4 top-1/4 w-1.5 h-1.5 bg-emerald-300/60 rounded-full" />
            </div>
          </div>
        </div>
        
        {/* Enhanced cinematic atmosphere with dynamic lighting layers */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Primary cosmic rays */}
          <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-purple-400/30 via-green-400/10 to-transparent animate-[cosmic_8s_ease_in_out_infinite]" />
          <div className="absolute top-0 right-1/4 w-px h-full bg-gradient-to-b from-green-400/30 via-purple-400/10 to-transparent animate-[cosmic_8s_ease_in_out_infinite_reverse]" />
          
          {/* Soft ambient glows */}
          <div className="absolute top-1/4 left-1/4 w-48 h-48 rounded-full bg-purple-400/10 blur-3xl animate-[float_5s_ease_in_out_infinite]" />
          <div className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full bg-green-400/10 blur-3xl animate-[float_5s_ease_in_out_infinite_reverse]" />
          
          {/* Energy ribbons */}
          <div className="absolute inset-0">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-400/20 to-transparent animate-[wave_6s_ease_in_out_infinite]" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-400/20 to-transparent animate-[wave_6s_ease_in_out_infinite_reverse]" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Message bubble component with premium styling and enhanced image handling
function MessageBubble({ message }: { message: Message }) {
  const isCustomer = message.sender_role === "customer";
  const isSupport = message.sender_role === "support";
  const isSystem = message.sender_role === "system";
  
  // Format timestamp
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  
  // Format date for grouping
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return date.toLocaleDateString();
  };
  
  return (
    <div className={`flex ${isCustomer ? "justify-end" : "justify-start"} mb-5 group`}>
      {/* Avatar for non-customer messages */}
      {!isSystem && !isCustomer && (
        <div className="flex-shrink-0 w-10 h-10 mr-3 self-end">
          <div className="w-full h-full rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg">
            <MessageCircle className="w-5 h-5 text-white" />
            {/* Online status indicator */}
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-black" />
          </div>
        </div>
      )}
      
      {/* Message content */}
      <div className={`max-w-[80%] ${isCustomer ? "ml-4" : "mr-4"} relative`}>
        {/* Message bubble with premium styling */}
        <div className={`
          rounded-2xl px-5 py-4 relative transition-all duration-300
          ${isCustomer 
            ? "bg-gradient-to-br from-go to-go/90 text-white shadow-go" 
            : isSupport
            ? "bg-gradient-to-br from-purple-600 to-purple-700 text-white shadow-purple"
            : "bg-gradient-to-br from-gray-700 to-gray-800 text-white shadow-lg"
          }
          hover:shadow-xl hover:scale-[1.01] transform transition-all duration-200
        `}>
          {/* Image attachment with enhanced display */}
          {message.message_type === "image" && message.attachment_url && (
            <div className="relative mb-3 rounded-xl overflow-hidden">
              <a 
                href={message.attachment_url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="block rounded-xl overflow-hidden hover:opacity-95 transition-opacity"
              >
                <img 
                  src={message.attachment_url} 
                  alt={JSON.parse(message.attachment_metadata || "{}")?.originalName || "Attachment"}
                  className="w-full h-auto object-cover max-h-80"
                  loading="lazy"
                  style={{ 
                    maxHeight: "320px",
                    imageRendering: "auto"
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent) {
                      parent.innerHTML = '<div class="p-4 text-center text-white/70 text-sm">Image failed to load</div>';
                    }
                  }}
                />
                {/* Attachment metadata overlay */}
                {message.attachment_metadata && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="truncate">{JSON.parse(message.attachment_metadata)?.originalName || "Image"}</span>
                      <span className="ml-2 text-white/60">
                        {JSON.parse(message.attachment_metadata)?.fileSize 
                          ? `${(JSON.parse(message.attachment_metadata).fileSize / 1024 / 1024).toFixed(1)}MB` 
                          : ""
                        }
                      </span>
                    </div>
                  </div>
                )}
              </a>
            </div>
          )}
          
          {/* Message text with premium typography */}
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words font-medium">
            {message.content}
          </p>
          
          {/* Timestamp and status indicators */}
          <div className="flex items-center justify-between mt-3 text-xs">
            <span className={`${
              isCustomer ? "text-white/70" : "text-white/70"
            }`}>
              {formatTime(message.created_at)}
            </span>
            
            {/* Status indicators for customer messages */}
            {isCustomer && (
              <div className="flex items-center space-x-1">
                {message.is_from_support ? (
                  <span className="text-white/60 text-xs">Delivered</span>
                ) : (
                  <span className="text-white/60 text-xs">Sent</span>
                )}
                {/* Read receipt indicator */}
                {message.is_from_support && (
                  <div className="flex -space-x-1">
                    <div className="w-4 h-4 rounded-full bg-green-400/30 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Support agent indicator */}
            {isSupport && (
              <span className="text-white/60 text-xs">GoDoor Support</span>
            )}
          </div>
        </div>
        
        {/* Date separator - shown on first message of each day */}
        {message.id && (
          <div className="text-center my-4">
            <span className="text-xs text-gray-500 bg-gray-800/50 px-3 py-1 rounded-full">
              {formatDate(message.created_at)}
            </span>
          </div>
        )}
      </div>
      
      {/* Avatar for customer messages (right-aligned) */}
      {isCustomer && (
        <div className="flex-shrink-0 w-10 h-10 ml-3 self-end">
          <div className="w-full h-full rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg">
            <Circle className="w-5 h-5 text-white" />
          </div>
        </div>
      )}
    </div>
  );
}

// Message composer component with enhanced UX
function MessageComposer({ 
  onSend: (message: string, file?: File) => Promise<void>, 
  conversationId: string 
}) {
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type
      const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      if (!allowedTypes.includes(selectedFile.type)) {
        alert("Please upload only JPG, PNG, or WebP images.");
        return;
      }
      
      // Validate file size (5MB max)
      if (selectedFile.size > 5 * 1024 * 1024) {
        alert("File size must be less than 5MB.");
        return;
      }
      
      setFile(selectedFile);
    }
  };
  
  const handleRemoveFile = () => {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() && !file) return;
    
    setIsSending(true);
    try {
      await onSend(message.trim(), file);
      setMessage("");
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      // Focus textarea after sending
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      alert("Failed to send message. Please try again.");
    } finally {
      setIsSending(false);
    }
  };
  
  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = (textareaRef.current.scrollHeight) + "px";
    }
  }, [message]);
  
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe your issue..."
          className="w-full min-h-[70px] rounded-2xl border border-gray-200 bg-white/80 backdrop-blur-sm px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-go/20 focus:border-go resize-none"
          rows={2}
          maxRows={6}
          disabled={isSending}
        />
        {file && (
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-xl">
              <img src={URL.createObjectURL(file)} alt="Preview" className="w-5 h-5 object-cover rounded" />
            </div>
            <button 
              onClick={handleRemoveFile}
              className="text-xs text-red-500 hover:text-red-700"
            >
              ✕
            </div>
          </div>
        )}
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 rounded-xl bg-blue-50 hover:bg-blue-100 flex items-center justify-center"
          >
            <Upload className="w-5 h-5 text-blue-600" />
          </button>
          <button
            type="submit"
            disabled={isSending || (!message.trim() && !file)}
            className={`ml-3 px-5 py-3 rounded-xl ${isSending ? "bg-gray-400 cursor-not-allowed" : "bg-gradient-to-r from-go to-go/20 hover:bg-gradient-to-r from-go/90 to-go/30"} text-white font-medium transition-colors`}
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="w-full h-1.5 bg-gradient-to-r from-go to-go/20 rounded">
          <div className={`h-1.5 bg-gradient-to-r from-go to-go/20 rounded transition-all duration-300`} style={{ width: `${uploadProgress}%` }}></div>
        </div>
      )}
    </div>
  );
}

// History overlay component with glassmorphism
function HistoryOverlay({ 
  isOpen: boolean, 
  onClose: () => void, 
  conversations: Conversation[],
  onSelectConversation: (conversationId: string) => void
}) {
  if (!isOpen) return null;
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };
  
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90vh] bg-white/95 backdrop-blur-md rounded-3xl border border-border shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-xl font-bold text-gray-900">Support History</h2>
          <button 
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-gray-500 mb-4">No conversations yet.</p>
              <p className="text-sm text-muted">Your support conversations will appear here when you contact GoDoor Support.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  className={`cursor-pointer p-4 rounded-2xl hover:bg-go/5 transition-colors border border-border/50 ${conv.status === "awaiting_user" ? "border-go/50" : ""} ${conv.status === "awaiting_support" ? "border-purple/50" : ""}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 line-clamp-2">{conv.subject}</h3>
                      <p className="text-xs text-gray-500 line-clamp-2">
                        {conv.latest_message?.content || "No messages"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={`px-3 py-1 rounded-full text-[9px] font-medium ${
                        conv.status === "open" ? "bg-go/10 text-go" :
                        conv.status === "awaiting_support" ? "bg-purple-100 text-purple-800" :
                        conv.status === "awaiting_user" ? "bg-green-100 text-green-800" :
                        conv.status === "resolved" ? "bg-gray-100 text-gray-600" :
                        "bg-gray-100 text-gray-400"
                      }`}>
                        {conv.status.replace(/_/g, " ").toUpperCase()}
                      </span>
                      <span className="ml-2">{formatDate(conv.last_message_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HelpPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  
  // Fetch current user
  useEffect(() => {
    const fetchUser = async () => {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUser(user);
          // Fetch user's conversations
          const { data: convData, error: convError } = await supabase
            .from("support_conversations")
            .select(`
              *,
              latest_message: messages!inner(
                id,
                created_at,
                sender_id,
                message_type,
                content
              )
            `)
            .eq("user_id", user.id)
            .order("last_message_at", { ascending: false });
          
          if (!convError && convData) {
            setConversations(convData);
            
            // Auto-select the most recent conversation or create a new one
            if (convData.length > 0) {
              setConversation(convData[0]);
              // Fetch messages for the selected conversation
              const { data: msgData, error: msgError } = await supabase
                .from("messages")
                .select(`
                  id,
                  conversation_id,
                  sender_id,
                  sender_name,
                  sender_role,
                  message_type,
                  content,
                  attachment_url,
                  attachment_metadata,
                  is_from_support,
                  created_at
                `)
                .eq("conversation_id", convData[0].id)
                .order("created_at", { ascending: true });
                
              if (!msgError && msgData) {
                setMessages(msgData);
                // Scroll to bottom
                setTimeout(() => {
                  messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                }, 100);
              }
            } else {
              // No conversations, create a new one
              createNewConversation();
            }
          }
        } else {
          // User not signed in
          setUser(null);
        }
      } catch (err) {
        console.error("Error fetching user:", err);
        setError("Failed to load user data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchUser();
  }, []);
  
  // Create a new conversation
  const createNewConversation = async () => {
    if (!user) return;
    
    try {
      const { data: newConv, error: convError } = await supabase
        .from("support_conversations")
        .insert({
          user_id: user.id,
          subject: "New Support Conversation",
          category: "general",
          status: "open"
        })
        .select()
        .single();
      
      if (convError) throw convError;
      
      // Create initial welcome message
      await supabase
        .from("messages")
        .insert({
          conversation_id: newConv.id,
          sender_id: null,
          sender_role: "system",
          message_type: "text",
          content: "Hi there! 👋\n\nTell us what's happening and we'll help you sort it out.\n\nYou can send a message and attach screenshots to explain your issue.",
          is_from_support: false,
        });
      
      setConversation(newConv);
      setMessages([
        {
          id: "welcome",
          conversation_id: newConv.id,
          sender_id: "",
          sender_name: "System",
          sender_role: "system",
          message_type: "text",
          content: "Hi there! 👋\n\nTell us what's happening and we'll help you sort it out.\n\nYou can send a message and attach screenshots to explain your issue.",
          attachment_url: null,
          attachment_metadata: null,
          is_from_support: false,
          created_at: new Date().toISOString()
        }
      ]);
      
      // Refresh conversations list
      const { data: convData } = await supabase
        .from("support_conversations")
        .select(`
          *,
          latest_message: messages!inner(
            id,
            created_at,
            sender_id,
            message_type,
            content
          )
        `)
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false });
        
      if (convData) setConversations(convData);
    } catch (err) {
      console.error("Error creating conversation:", err);
      setError("Failed to start conversation");
    }
  };
  
  // Send a message
  const sendMessage = async (text: string, file?: File) => {
    if (!conversation || !user) return;
    
    try {
      let attachmentUrl = null;
      let attachmentMetadata = null;
      
      // Handle file upload if provided
      if (file) {
        // Upload file to Supabase storage
        const fileExt = file.name.split(".").pop();
        const fileName = `${conversation.id}/${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
        const filePath = `support-attachments/${fileName}`;
        
        const { data: uploadData, error: uploadError } = await supabase
          .storage
          .from("godoor-assets")
          .upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
          });
          
        if (uploadError) throw uploadError;
        
        const { data: publicUrlData } = supabase
          .storage
          .from("godoor-assets")
          .getPublicUrl(filePath);
          
        attachmentUrl = publicUrlData.publicUrl;
        attachmentMetadata = JSON.stringify({
          originalName: file.name,
          fileType: file.type,
          fileSize: file.size,
          uploadedAt: new Date().toISOString()
        });
      }
      
      // Insert the message
      const { data: newMessage, error: msgError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          sender_id: user.id,
          sender_role: "customer",
          sender_name: user.email?.split("@")[0] || "Customer",
          message_type: file ? "image" : "text",
          content: text,
          attachment_url: attachmentUrl,
          attachment_metadata: attachmentMetadata,
          is_from_support: false,
        })
        .select()
        .single();
      
      if (msgError) throw msgError;
      
      // Update conversation
      await supabase
        .from("support_conversations")
        .update({
          last_message_at: new Date().toISOString(),
          status: "awaiting_support"
        })
        .eq("id", conversation.id);
      
      // Refresh messages and conversations
      const { data: msgData } = await supabase
        .from("messages")
        .select(`
          id,
          conversation_id,
          sender_id,
          sender_name,
          sender_role,
          message_type,
          content,
          attachment_url,
          attachment_metadata,
          is_from_support,
          created_at
        `)
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });
      
      if (msgData) {
        setMessages(msgData);
        // Scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
      
      const { data: convData } = await supabase
        .from("support_conversations")
        .select(`
          *,
          latest_message: messages!inner(
            id,
            created_at,
            sender_id,
            message_type,
            content
          )
        `)
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false });
      
      if (convData) setConversations(convData);
    } catch (err) {
      console.error("Error sending message:", err);
      setError("Failed to send message");
    }
  };
  
  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
          <p className="mt-2 text-sm">Loading GoDoor Support...</p>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-red-400" />
          <p className="mt-2 text-sm text-red-400">{error}</p>
        </div>
      </div>
    );
  }
  
  if (!user) {
    return (
      <div className="min-h-screen bg-black">
        {/* Premium cinematic background */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-900 opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-green-500/10 to-transparent" />
          {/* Floating particles */}
          <div className="absolute inset-0">
            <div className="absolute w-4 h-4 bg-purple-400/20 rounded-full blur-sm animate-[float_3s_ease_in_out_infinite]" style={{ top: "20%", left: "10%" }} />
            <div className="absolute w-3 h-3 bg-green-400/20 rounded-full blur-sm animate-[float_2s_ease_in_out_infinite]" style={{ top: "70%", right: "15%" }} />
            <div className="absolute w-5 h-5 bg-purple-300/15 rounded-full blur-sm animate-[float_4s_ease_in_out_infinite]" style={{ bottom: "30%", left: "20%" }} />
            <div className="absolute w-4 h-4 bg-green-300/10 rounded-full blur-sm animate-[float_3s_ease_in_out_infinite reverse]" style={{ bottom: "10%", right: "25%" }} />
          </div>
        </div>
        
        <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md space-y-8">
            <div className="text-center">
              <Logo size="lg" className="mx-auto mb-8" />
              <h2 className="text-3xl font-bold text-white">GoDoor Support</h2>
              <p className="text-gray-400">Please sign in to access support</p>
              <div className="space-y-4">
                <a 
                  href="https://wa.me/256750685772?text=Hi%20GoDoor%2C%20I%20need%20help"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-4 rounded-2xl border border-gray-600 bg-white/10 backdrop-blur-sm px-6 py-4 text-sm font-medium hover:bg-white/20 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <MessageCircle className="w-6 h-6 text-green-400" />
                    <span>WhatsApp Support</span>
                  </div>
                </a>
                <a 
                  href="mailto:support@godoor.site"
                  className="w-full flex items-center justify-center gap-4 rounded-2xl border border-gray-600 bg-white/10 backdrop-blur-sm px-6 py-4 text-sm font-medium hover:bg-white/20 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Mail className="w-6 h-6 text-blue-400" />
                    <span>Email Support</span>
                  </div>
                </a>
              </div>
            </div>
          </div>
          
          {/* Full-screen Explore button at bottom */}
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 w-full max-w-md px-4">
            <button
              onClick={() => {
                // Show login/signup modal - for now we'll simulate by focusing on the login form
                const loginSection = document.querySelector('[data-login-section]');
                if (loginSection) {
                  loginSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }}
              className="w-full py-4 px-6 bg-transparent border border-white/30 backdrop-blur-sm rounded-2xl text-white font-medium text-lg hover:bg-white/10 transition-all duration-300 transform hover:scale-105 active:scale-95"
            >
              Explore
            </button>
          </div>
        </div>
        
        {/* Transparent Explore login popup section - always visible but expands on explore click */}
        <div 
          data-login-section
          className="relative z-20 w-full max-w-4xl mx-auto px-4 mt-12 mb-8"
        >
          <div className="bg-black/40 backdrop-blur-sm rounded-3xl border border-white/20 p-8 transition-all duration-500 hover:bg-black/50 hover:border-white/30">
            <div className="flex flex-col md:flex-row gap-8 items-center">
              {/* Left side - Login form */}
              <div className="flex-1 w-full">
                <h3 className="text-2xl font-bold text-white mb-2">Welcome Back</h3>
                <p className="text-gray-400 mb-6">Sign in to your account to continue</p>
                
                <form className="space-y-4">
                  <div>
                    <input
                      type="email"
                      placeholder="Email address"
                      className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:bg-white/20 transition-all"
                    />
                  </div>
                  <div>
                    <input
                      type="password"
                      placeholder="Password"
                      className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:bg-white/20 transition-all"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input type="checkbox" className="w-4 h-4 rounded border-gray-600 bg-transparent" />
                      Remember me
                    </label>
                    <a href="#" className="text-sm text-purple-400 hover:text-purple-300">Forgot password?</a>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-green-600 rounded-xl font-semibold text-white hover:from-purple-700 hover:to-green-700 transition-all duration-300 transform hover:scale-105"
                  >
                    Sign In
                  </button>
                </form>
                
                <div className="mt-6 text-center">
                  <p className="text-gray-400">
                    Don't have an account?{' '}
                    <a href="#" className="text-purple-400 hover:text-purple-300 font-semibold">Sign up</a>
                  </p>
                </div>
              </div>
              
              {/* Right side - Explore information */}
              <div className="flex-1 w-full border-t md:border-t-0 md:border-l border-white/20 pt-6 md:pt-0 md:pl-8">
                <h4 className="text-xl font-bold text-white mb-4">What You Can Explore</h4>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-purple-600/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Store className="w-4 h-4 text-purple-400" />
                    </div>
                    <div>
                      <h5 className="font-semibold text-white">Browse Merchants</h5>
                      <p className="text-sm text-gray-400">Discover local businesses and services</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-green-600/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Truck className="w-4 h-4 text-green-400" />
                    </div>
                    <div>
                      <h5 className="font-semibold text-white">Track Deliveries</h5>
                      <p className="text-sm text-gray-400">Real-time location tracking</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-blue-600/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Wallet className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <h5 className="font-semibold text-white">Manage Payments</h5>
                      <p className="text-sm text-gray-400">Secure wallet and transactions</p>
                    </div>
                  </div>
                </div>
                
                <div className="mt-6 p-4 bg-gradient-to-br from-purple-900/30 to-green-900/30 rounded-xl border border-white/10">
                  <p className="text-sm text-gray-300">
                    <strong className="text-white">New to GoDoor?</strong> Join thousands of users who trust GoDoor for reliable local delivery services.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-black">
      {/* Premium cinematic background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-900 opacity-95" />
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-green-500/5 to-transparent" />
        {/* Animated light particles */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute w-2 h-2 bg-purple-400/30 rounded-full" style={{ top: "15%", left: "25%" }} />
          <div className="absolute w-3 h-3 bg-green-400/30 rounded-full" style={{ top: "40%", right: "30%" }} />
          <div className="absolute w-4 h-4 bg-purple-300/20 rounded-full" style={{ bottom: "20%", left: "35%" }} />
          <div className="absolute w-2 h-2 bg-green-300/20 rounded-full" style={{ bottom: "40%", right: "15%" }} />
          {/* Light rays */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-500 to-transparent opacity-10 animate-[shine_4s_linear_infinite]" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-green-500 to-transparent opacity-8 animate-[shine_6s_linear_infinite]" />
        </div>
      </div>
      
      {/* Main Chat Interface */}
      <div className="relative z-10 min-h-screen">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-sm border-b border-border/50">
          <div className="mx-auto max-w-4xl px-6 py-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <SupportAvatar />
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-white">How can we help?</h1>
                  <p className="text-lg text-gray-400">We're here to help with your GoDoor experience.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setIsHistoryOpen(true)}
                  className="p-3 text-gray-400 hover:text-gray-200 hover:bg-white/10 rounded-xl transition-colors"
                >
                  <Circle className="w-5 h-5" />
                  <span className="ml-2 text-sm">History</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        
        {/* Messages Area */}
        <div className="flex-1 overflow-hidden">
          <div className="p-6 space-y-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
        
        {/* Message Composer - Floating at bottom */}
        <div className="absolute bottom-0 left-0 right-0">
          <div className="bg-white/10 backdrop-blur-sm border-t border-border/50">
            <div className="mx-auto max-w-4xl px-6 py-6">
              <MessageComposer 
                onSend={sendMessage} 
                conversationId={conversation?.id || ""}
              />
            </div>
          </div>
        </div>
      </div>
      
      {/* History Overlay */}
      <HistoryOverlay 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)} 
        conversations={conversations} 
        onSelectConversation={(convId) => {
          setIsHistoryOpen(false);
          const selectedConv = conversations.find(c => c.id === convId);
          if (selectedConv) {
            setConversation(selectedConv);
            // Fetch messages for selected conversation
            supabase
              .from("messages")
              .select(`
                id,
                conversation_id,
                sender_id,
                sender_name,
                sender_role,
                message_type,
                content,
                attachment_url,
                attachment_metadata,
                is_from_support,
                created_at
              `)
              .eq("conversation_id", convId)
              .order("created_at", { ascending: true })
              .then(({ data, error }) => {
                if (!error && data) {
                  setMessages(data);
                  // Scroll to bottom
                  setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                  }, 100);
                }
              });
          }
        }} 
      />
      
      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-6 left-6 right-6 z-50">
          <div className="bg-red-50/90 backdrop-blur-sm rounded-2xl border border-red-200 p-5">
            <div className="flex items-start gap-4">
              <AlertTriangle className="w-6 h-6 text-red-500 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="text-xs text-red-600">{error}</p>
              </div>
              <button 
                onClick={() => setError(null)}
                className="ml-auto p-2 text-red-500 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}