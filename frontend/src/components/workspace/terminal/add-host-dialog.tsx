import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, X } from 'lucide-react';
import { tr } from '@/core/i18n';
import { useI18n } from '@/core/i18n/hooks';

export interface AddHostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddHost?: (host: any) => void;
  onEditHost?: (id: string, host: any) => void;
  editAsset?: any;
  credentials?: any[];
  groups?: any[];
  onAddCredentialClick?: () => void;
}

export function AddHostDialog({ open, onOpenChange, onAddHost, onEditHost, editAsset, credentials = [], groups = [], onAddCredentialClick }: AddHostDialogProps) {
  const { locale } = useI18n();
  const [formData, setFormData] = useState({
    name: '',
    ip: '',
    port: '22',
    username: 'root',
    keychain_id: '',
    group_id: '',
    password: ''
  });
  
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testLog, setTestLog] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  React.useEffect(() => {
    if (open) {
      if (editAsset) {
        setFormData({
          name: editAsset.name || '',
          ip: editAsset.ip || '',
          port: String(editAsset.port || '22'),
          username: editAsset.username || 'root',
          keychain_id: editAsset.keychain_id || '',
          group_id: editAsset.group_id || '',
          password: '' // Don't prefill password for security
        });
      } else {
        setFormData({
          name: '',
          ip: '',
          port: '22',
          username: 'root',
          keychain_id: '',
          group_id: '',
          password: ''
        });
      }
      setTestStatus('idle');
      setTestLog('');
      setIsCreatingGroup(false);
      setNewGroupName('');
    }
  }, [open, editAsset]);

  const handleTestConnection = async () => {
    setTestStatus('testing');
    try {
      const res = await fetch('/api/v1/assets/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          port: parseInt(formData.port, 10) || 22
        })
      });
      
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        setTestStatus('error');
        setTestLog(`Invalid response (${res.status}): ${text.substring(0, 100)}...`);
        return;
      }

      if (!res.ok) {
        setTestStatus('error');
        const errDetail = data.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : null;
        setTestLog(data.message || errDetail || `HTTP Error ${res.status}: ${JSON.stringify(data)}`);
        return;
      }

      if (data.status === 'ok') {
        setTestStatus('success');
        setTestLog(data.message || tr(locale, '连接测试成功', 'Connection test succeeded', 'Kiểm tra kết nối thành công'));
      } else {
        setTestStatus('error');
        setTestLog(data.message || JSON.stringify(data) || tr(locale, '连接测试失败', 'Connection test failed', 'Kiểm tra kết nối thất bại'));
      }
    } catch (e: any) {
      setTestStatus('error');
      setTestLog(e.message || tr(locale, '网络请求失败', 'Network request failed', 'Yêu cầu mạng thất bại'));
    }
  };

  const handleSubmit = async () => {
    let finalGroupId = formData.group_id;
    
    if (isCreatingGroup && newGroupName.trim()) {
      try {
        const res = await fetch('/api/v1/assets/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newGroupName.trim() })
        });
        if (res.ok) {
          const newGroup = await res.json();
          finalGroupId = newGroup.id;
        } else {
          const err = await res.json().catch(() => ({}));
          setTestStatus('error');
          setTestLog(`${tr(locale, '新建分组失败', 'Failed to create group', 'Tạo nhóm thất bại')}: ${err.message || res.statusText}`);
          return;
        }
      } catch (e: any) {
        setTestStatus('error');
        setTestLog(`${tr(locale, '新建分组失败', 'Failed to create group', 'Tạo nhóm thất bại')}: ${e.message}`);
        return;
      }
    }

    const payload = {
      ...formData,
      port: parseInt(formData.port, 10) || 22,
      group_id: finalGroupId || null
    };

    if (editAsset && onEditHost) {
      onEditHost(editAsset.id, payload);
    } else if (onAddHost) {
      onAddHost(payload);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{editAsset ? tr(locale, '编辑主机', 'Edit Host', 'Chỉnh sửa máy chủ') : tr(locale, '添加主机', 'Add Host', 'Thêm máy chủ')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">{tr(locale, '名称/别名', 'Name / Alias', 'Tên / Bí danh')}</label>
            <Input 
              placeholder={tr(locale, '例如：生产环境-DB', 'e.g. Prod-DB', 'vd: Production-DB')} 
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 grid gap-2">
              <label className="text-sm font-medium">{tr(locale, 'IP 地址', 'IP Address', 'Địa chỉ IP')}</label>
              <Input 
                placeholder="192.168.1.1" 
                value={formData.ip}
                onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
              />
            </div>
            <div className="col-span-1 grid gap-2">
              <label className="text-sm font-medium">{tr(locale, '端口', 'Port', 'Cổng')}</label>
              <Input 
                placeholder="22" 
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">{tr(locale, '用户名', 'Username', 'Tên đăng nhập')}</label>
              <Input 
                placeholder="root" 
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">{tr(locale, '所属分组', 'Group', 'Nhóm')}</label>
              {isCreatingGroup ? (
                <div className="flex items-center gap-2">
                  <Input 
                    autoFocus 
                    placeholder={tr(locale, '输入新分组名称', 'Enter new group name', 'Nhập tên nhóm mới')} 
                    value={newGroupName} 
                    onChange={(e) => setNewGroupName(e.target.value)} 
                  />
                  <Button variant="ghost" size="icon" onClick={() => {
                    setIsCreatingGroup(false);
                    setNewGroupName('');
                    setFormData({ ...formData, group_id: '' });
                  }}>
                    <X className="w-4 h-4 text-zinc-400" />
                  </Button>
                </div>
              ) : (
                <Select 
                  value={formData.group_id || 'none'} 
                  onValueChange={(val) => {
                    if (val === 'new_group') {
                      setIsCreatingGroup(true);
                      setFormData({ ...formData, group_id: '' });
                    } else {
                      setFormData({ ...formData, group_id: val === 'none' ? '' : val });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={tr(locale, '未分组', 'Ungrouped', 'Chưa phân nhóm')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tr(locale, '未分组', 'Ungrouped', 'Chưa phân nhóm')}</SelectItem>
                    {groups.map(g => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                    <SelectItem value="new_group" className="text-blue-600 font-medium">{tr(locale, '+ 新建分组...', '+ New Group...', '+ Tạo nhóm mới...')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">{tr(locale, '服务器密码', 'Password', 'Mật khẩu máy chủ')}</label>
            <div className="relative mt-1">
              <Input 
                type={showPassword ? "text" : "password"}
                placeholder={tr(locale, '直接输入服务器密码', 'Enter server password', 'Nhập mật khẩu máy chủ')} 
                className="pr-10"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 focus:outline-none"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          
          {testStatus !== 'idle' && (
            <div className={`p-3 rounded-lg text-xs font-mono break-all ${
              testStatus === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              testStatus === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
              'bg-blue-50 text-blue-700 border border-blue-200'
            }`}>
              {testStatus === 'testing' && <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {tr(locale, '正在测试连接...', 'Testing connection...', 'Đang kiểm tra kết nối...')}</span>}
              {testStatus === 'success' && <span className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> {testLog}</span>}
              {testStatus === 'error' && <span className="flex items-start gap-2"><XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span className="whitespace-pre-wrap">{testLog}</span></span>}
            </div>
          )}
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button 
              variant="outline" 
              className="text-blue-600 border-blue-200 hover:bg-blue-50"
              onClick={handleTestConnection}
              disabled={!formData.ip || !formData.username || !formData.password || testStatus === 'testing'}
            >
              {tr(locale, '测试连接', 'Test Connection', 'Kiểm tra kết nối')}
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{tr(locale, '取消', 'Cancel', 'Hủy')}</Button>
              <Button onClick={handleSubmit} disabled={!formData.name || !formData.ip || !formData.password}>{tr(locale, '确定', 'Confirm', 'Xác nhận')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
