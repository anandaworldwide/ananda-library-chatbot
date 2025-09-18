import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { logEvent } from "@/utils/client/analytics";

interface ConversationMenuProps {
  onRename: () => void;
  onDelete: () => void;
  isVisible: boolean;
  isRowSelected?: boolean;
}

interface MenuPosition {
  top: number;
  left: number;
  right?: number;
}

export default function ConversationMenu({ onRename, onDelete, isVisible, isRowSelected }: ConversationMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Close menu when parent becomes invisible
  useEffect(() => {
    if (!isVisible) {
      setIsOpen(false);
    }
  }, [isVisible]);

  // Handle window resize and scroll to reposition menu
  useEffect(() => {
    if (!isOpen) return;

    const handleReposition = () => {
      const position = calculateMenuPosition();
      setMenuPosition(position);
    };

    const handleScroll = () => {
      // Close menu on scroll to avoid confusion
      setIsOpen(false);
    };

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleScroll, true); // Use capture to catch all scroll events

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen]);

  const calculateMenuPosition = (): MenuPosition => {
    if (!buttonRef.current) return { top: 0, left: 0 };

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 128; // w-32 = 128px
    const menuHeight = 80; // Approximate height for 2 menu items
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Use fixed positioning relative to viewport, not absolute with scroll offset
    let top = buttonRect.bottom + 4; // 4px gap below button
    let left = buttonRect.right - menuWidth; // Align right edge with button

    // Adjust if menu would go off the right edge
    if (left < 8) {
      left = 8; // 8px margin from left edge
    }

    // Adjust if menu would go off the left edge
    if (left + menuWidth > viewportWidth - 8) {
      left = viewportWidth - menuWidth - 8; // 8px margin from right edge
    }

    // Adjust if menu would go off the bottom edge
    if (top + menuHeight > viewportHeight - 8) {
      top = buttonRect.top - menuHeight - 4; // Position above button
    }

    // Ensure menu doesn't go above viewport
    if (top < 8) {
      top = 8; // 8px margin from top
    }

    return { top, left };
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isOpen) {
      // Track menu button click event
      logEvent("chat_history_menu_open", "Chat History", "conversation_menu_opened");

      const position = calculateMenuPosition();
      setMenuPosition(position);
    }

    setIsOpen(!isOpen);
  };

  const handleRename = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);

    // Track rename action
    logEvent("chat_history_rename_click", "Chat History", "conversation_rename_initiated");

    onRename();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);

    // Track delete action
    logEvent("chat_history_delete_click", "Chat History", "conversation_delete_initiated");

    onDelete();
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="relative">
      {/* Three-dot menu button */}
      <button
        ref={buttonRef}
        onClick={handleMenuClick}
        className={`p-1 rounded-md text-gray-500 transition-colors duration-150 ${
          isRowSelected ? "opacity-100" : "opacity-0"
        } group-hover:[@media(hover:hover)]:opacity-100`}
        style={{
          backgroundColor: isRowSelected ? "#fffbee" : "transparent",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#fffbee";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = isRowSelected ? "#fffbee" : "transparent";
        }}
        aria-label="Conversation options"
        title="More options"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="text-gray-600"
        >
          <circle cx="8" cy="3" r="1.5" fill="currentColor" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
          <circle cx="8" cy="13" r="1.5" fill="currentColor" />
        </svg>
      </button>

      {/* Dropdown menu - rendered as portal to avoid clipping */}
      {isOpen &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed w-32 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
            }}
          >
            <button
              onClick={handleRename}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center"
            >
              <span className="material-icons text-sm mr-2">edit</span>
              Rename
            </button>
            <button
              onClick={handleDelete}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center"
            >
              <span className="material-icons text-sm mr-2">delete</span>
              Delete
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
