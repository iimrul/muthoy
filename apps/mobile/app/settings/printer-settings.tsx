import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { buildTestPrint } from '../../domain/escpos';
import {
  getPairedPrinter, printEscPos, PrinterError, removePairedPrinter, savePairedPrinter, scanBlePrinters,
  type DiscoveredPrinter, type PairedPrinter,
} from '../../native/printer';
import { useI18n } from '../../state/localeStore';
import { useOwnerAccess } from '../../state/usePermission';

type Status = { type: 'ok'|'error'|'info'; message: string };
function messageFor(error: unknown, bn: boolean): string {
  const code = error instanceof PrinterError ? error.code : 'unknown';
  const labels: Record<string,[string,string]> = { 'no-device':['কোনো প্রিন্টার বাছাই করা নেই','No printer selected'], 'out-of-range':['প্রিন্টার রেঞ্জের বাইরে','Printer out of range'], disconnected:['সংযোগ বিচ্ছিন্ন','Printer disconnected'], 'send-failed':['প্রিন্ট পাঠানো যায়নি','Print send failed'], unsupported:['এই BLE প্রিন্টার সমর্থিত নয়','This BLE printer is unsupported'], 'permission-denied':['Bluetooth অনুমতি দিন','Grant Bluetooth permission'], unknown:['প্রিন্টার সংযোগ ব্যর্থ','Printer connection failed'] };
  const pair = labels[code] ?? labels.unknown ?? ['প্রিন্টার সংযোগ ব্যর্থ','Printer connection failed'];
  return pair[bn ? 0 : 1];
}

export default function PrinterSettingsScreen() {
  const { locale, formatDateTime } = useI18n(); const bn = locale === 'bn'; const { session, isAllowed } = useOwnerAccess();
  const [printer, setPrinter] = useState<PairedPrinter | null>(() => getPairedPrinter()); const [devices, setDevices] = useState<DiscoveredPrinter[]>([]);
  const [showDevices, setShowDevices] = useState(false); const [busy, setBusy] = useState<'scan'|'test'|null>(null);
  const [status, setStatus] = useState<Status | null>(null); const [lastAction, setLastAction] = useState<'scan'|'test'>('scan');
  if (!session) return <AccessDenied message={bn ? 'সক্রিয় সেশন প্রয়োজন।' : 'Active session required.'} />;
  if (!isAllowed) return <AccessDenied />;
  const scan = async () => {
    setBusy('scan'); setLastAction('scan'); setStatus({ type:'info', message: bn ? 'কাছাকাছি BLE প্রিন্টার খোঁজা হচ্ছে…' : 'Scanning for nearby BLE printers…' });
    try { const found = await scanBlePrinters(); setDevices(found); setShowDevices(true); setStatus(found.length ? null : { type:'error', message: bn ? 'কোনো BLE প্রিন্টার পাওয়া যায়নি' : 'No BLE printers found' }); }
    catch (error) { setStatus({ type:'error', message: messageFor(error,bn) }); } finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test'); setLastAction('test'); setStatus({ type:'info', message: bn ? 'টেস্ট প্রিন্ট পাঠানো হচ্ছে…' : 'Sending test print…' });
    try { await printEscPos(buildTestPrint(), printer); setPrinter(getPairedPrinter()); setStatus({ type:'ok', message: bn ? 'সংযোগ যাচাই হয়েছে এবং টেস্ট প্রিন্ট সম্পন্ন' : 'Connection validated and test print completed' }); }
    catch (error) { setStatus({ type:'error', message: messageFor(error,bn) }); } finally { setBusy(null); }
  };
  const select = (device: DiscoveredPrinter) => { const saved = savePairedPrinter(device); setPrinter(saved); setShowDevices(false); setStatus({ type:'info', message: bn ? 'প্রিন্টার বাছাই হয়েছে — সংযোগ যাচাই করতে টেস্ট প্রিন্ট দিন' : 'Printer selected — run Test Print to verify the connection' }); };
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={bn ? 'প্রিন্টার সেটিংস' : 'Printer Settings'} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-28">
        <View className="rounded-2xl border border-[#FCD34D] bg-[#FEF3C7] p-3"><Text className="font-sans text-xs text-[#92400E]">{bn ? 'থার্মাল প্রিন্ট শুধু ইংরেজিতে হবে (Beta)। Bluetooth চালু রাখুন।' : 'Thermal output is English-only in Beta. Keep Bluetooth enabled.'}</Text></View>
        <View className="rounded-2xl bg-white p-4"><View className="mb-3 flex-row items-center gap-3"><View className="h-12 w-12 items-center justify-center rounded-xl bg-[#DBEAFE]"><Feather name="bluetooth" size={24} color="#1D4ED8" /></View><View className="flex-1"><Text className="font-sans-bold text-sm">{printer?.name ?? (bn ? 'কোনো প্রিন্টার বাছাই করা নেই' : 'No printer selected')}</Text><Text numberOfLines={1} className="font-sans text-xs text-midGray">{printer ? printer.validatedAt ? `${bn ? 'যাচাইকৃত' : 'Validated'}: ${formatDateTime(printer.validatedAt)}` : (bn ? 'বাছাই করা হয়েছে · এখনো যাচাই হয়নি' : 'Selected · not yet validated') : 'ESC/POS · Epson TM · Star SM'}</Text></View></View><View className="flex-row gap-2"><Pressable disabled={busy !== null} onPress={() => void scan()} className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-brand-green py-3 disabled:opacity-50"><Feather name="bluetooth" size={16} color="#FFFFFF" /><Text className="font-sans-bold text-sm text-white">{busy === 'scan' ? '…' : printer ? (bn ? 'পুনরায় বাছুন' : 'Re-select') : (bn ? 'বাছুন' : 'Select')}</Text></Pressable><Pressable disabled={busy !== null || !printer} onPress={() => void test()} className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border-2 border-brand-green py-3 disabled:opacity-50"><Feather name="printer" size={16} color="#047857" /><Text className="font-sans-bold text-sm text-brand-deepGreen">{busy === 'test' ? '…' : (bn ? 'টেস্ট প্রিন্ট' : 'Test Print')}</Text></Pressable></View>{printer ? <Pressable onPress={() => { removePairedPrinter(); setPrinter(null); setStatus({ type:'info', message: bn ? 'প্রিন্টার সরানো হয়েছে' : 'Printer removed' }); }} className="mt-2 flex-row items-center justify-center gap-2 py-2"><Feather name="trash-2" size={16} color="#B91C1C" /><Text className="font-sans text-sm text-error">{bn ? 'প্রিন্টার সরান' : 'Remove printer'}</Text></Pressable> : null}</View>
        {status ? <View className={`flex-row items-start gap-2 rounded-2xl border p-3 ${status.type === 'ok' ? 'border-[#A7F3D0] bg-brand-softGreen' : status.type === 'error' ? 'border-[#FCA5A5] bg-[#FEE2E2]' : 'border-[#93C5FD] bg-[#DBEAFE]'}`}><Feather name={status.type === 'ok' ? 'check-circle' : status.type === 'error' ? 'alert-triangle' : 'printer'} size={16} color={status.type === 'ok' ? '#047857' : status.type === 'error' ? '#B91C1C' : '#1E40AF'} /><View className="flex-1"><Text className="font-sans text-xs">{status.message}</Text>{status.type === 'error' ? <Pressable onPress={() => lastAction === 'test' ? void test() : void scan()}><Text className="mt-1 font-sans-bold text-xs text-error underline">{bn ? 'আবার চেষ্টা করুন' : 'Retry'}</Text></Pressable> : null}</View></View> : null}
        <View className="rounded-2xl bg-white p-4"><Text className="mb-2 font-sans-bold text-sm">{bn ? 'সমর্থিত মডেল' : 'Supported Models'}</Text>{['Epson TM-m30, TM-T20, TM-T82 (ESC/POS)','Star Micronics SM-L200, SM-L300, SM-T300i',bn ? 'বেশিরভাগ BLE ESC/POS প্রিন্টার' : 'Most generic BLE ESC/POS printers'].map((value) => <Text key={value} className="py-1 font-sans text-xs text-[#374151]">• {value}</Text>)}</View>
      </ScrollView>
      <Modal visible={showDevices} transparent animationType="slide" onRequestClose={() => setShowDevices(false)}><View className="flex-1 justify-end bg-black/50"><View className="max-h-[70%] gap-3 rounded-t-3xl bg-white p-5 pb-8"><View className="flex-row items-center justify-between"><Text className="font-sans-bold text-lg">{bn ? 'একটি প্রিন্টার বাছুন' : 'Select a printer'}</Text><Pressable onPress={() => setShowDevices(false)}><Feather name="x" size={22} color="#111827" /></Pressable></View><ScrollView>{devices.map((device) => <Pressable key={device.id} onPress={() => select(device)} className="flex-row items-center gap-3 border-b border-[#E5E7EB] py-4"><View className="h-10 w-10 items-center justify-center rounded-xl bg-[#DBEAFE]"><Feather name="printer" size={18} color="#1D4ED8" /></View><View className="flex-1"><Text className="font-sans-semibold">{device.name}</Text><Text className="font-mono text-xs text-midGray">{device.id} · {device.rssi} dBm</Text></View><Feather name="chevron-right" size={18} color="#059669" /></Pressable>)}</ScrollView></View></View></Modal>
    </View>
  );
}
