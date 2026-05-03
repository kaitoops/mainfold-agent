/**
 * InputBar — 底部输入框 + 发送按钮 + 图片上传
 *
 * 从 ChatPage.tsx 提取。
 * 键盘事件（Enter 发送，Shift+Enter 换行）在组件内处理。
 */

import { useCallback } from 'react';
import { Send, Image, X } from 'lucide-react';

// ── Props ──

interface InputBarProps {
  input: string;
  onInputChange: (val: string) => void;
  isLoading: boolean;
  onSendMessage: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadedImages: string[];
  onImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: (index: number) => void;
}

// ── 组件 ──

export default function InputBar({
  input,
  onInputChange,
  isLoading,
  onSendMessage,
  inputRef,
  fileInputRef,
  uploadedImages,
  onImageSelect,
  onRemoveImage,
}: InputBarProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSendMessage();
      }
    },
    [onSendMessage],
  );

  return (
    <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50">
      {/* 图片预览 */}
      {uploadedImages.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {uploadedImages.map((url, index) => (
            <div key={index} className="relative group">
              <img
                src={url}
                alt={`上传图片 ${index + 1}`}
                className="w-16 h-16 object-cover rounded-lg border border-gray-700"
              />
              <button
                onClick={() => onRemoveImage(index)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 items-end">
        {/* 图片上传按钮 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
          title="上传图片"
        >
          <Image size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onImageSelect}
        />

        {/* 文本输入 */}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-primary-500 transition-colors"
          rows={1}
          style={{ minHeight: '44px', maxHeight: '120px' }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
          }}
        />

        {/* 发送按钮 */}
        <button
          onClick={onSendMessage}
          disabled={!input.trim() || isLoading}
          className="px-4 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm transition-colors"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
