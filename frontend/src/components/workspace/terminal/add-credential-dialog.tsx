import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Eye, EyeOff } from 'lucide-react';
import { tr } from '@/core/i18n';
import { useI18n } from '@/core/i18n/hooks';

export interface AddCredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddCredential?: (credential: any) => void;
}

export function AddCredentialDialog({ open, onOpenChange, onAddCredential }: AddCredentialDialogProps) {
  const { locale } = useI18n();
  const [formData, setFormData] = useState({
    name: '',
    type: 'password',
    value: ''
  });
  
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = () => {
    if (onAddCredential) {
      onAddCredential(formData);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{tr(locale, '新建凭证', 'New Credential', 'Thêm thông tin xác thực')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">{tr(locale, '凭证名称', 'Credential Name', 'Tên thông tin xác thực')}</label>
            <Input 
              placeholder={tr(locale, '例如：跳板机密码 / 生产环境私钥', 'e.g. Bastion Password / Prod SSH Key', 'vd: Mật khẩu máy chủ / Khóa SSH Production')} 
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">{tr(locale, '类型', 'Type', 'Loại')}</label>
            <Select 
              value={formData.type} 
              onValueChange={(val) => setFormData({ ...formData, type: val, value: '' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">{tr(locale, 'Password (密码)', 'Password', 'Mật khẩu (Password)')}</SelectItem>
                <SelectItem value="ssh_key">{tr(locale, 'SSH Key (私钥)', 'SSH Key', 'Khóa SSH (Private Key)')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">
              {formData.type === 'password'
                ? tr(locale, '密码', 'Password', 'Mật khẩu')
                : tr(locale, '私钥内容', 'Private Key', 'Nội dung khóa riêng')}
            </label>
            {formData.type === 'password' ? (
              <div className="relative mt-1">
                <Input 
                  type={showPassword ? "text" : "password"}
                  placeholder={tr(locale, '输入密码', 'Enter password', 'Nhập mật khẩu')} 
                  className="pr-10"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 focus:outline-none"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            ) : (
              <Textarea
                placeholder="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----" 
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                className="font-mono text-[11px] h-36 leading-relaxed resize-none p-3 bg-zinc-50 border-zinc-200"
                spellCheck={false}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tr(locale, '取消', 'Cancel', 'Hủy')}</Button>
          <Button onClick={handleSubmit} disabled={!formData.name || !formData.value}>{tr(locale, '确定', 'Confirm', 'Xác nhận')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
