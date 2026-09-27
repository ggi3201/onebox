/**
 * The chat UI: messages, tool status, proposal cards, a composer with a photo
 * button, and Stop. Plain StyleSheet; swap the colors for your theme.
 *
 * Mount it as a screen (expo-router: app/chat.tsx) or inside a sheet. If you
 * mount it in a Modal, render the consent prompt INSIDE it as an overlay: iOS
 * will not present a second Modal over one that is already up.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS, ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { pickImage, type Attachment } from './attach';
import { Markdown } from './Markdown';
import { explainError, useChatStore, type Message, type Proposal, type ViewContext } from './store';

/** What each tool is doing, in words. The name alone reads like a log line. */
const TOOL_LABELS: Record<string, string> = {
  list_items: 'Looking through your items',
  get_item: 'Reading the item',
  propose_item_change: 'Preparing a change',
};

export function ChatScreen({ view, onPaywall }: { view: ViewContext; onPaywall?: () => void }) {
  const { messages, running, error, send, stop } = useChatStore();
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    // After layout, or it scrolls to the end of the PREVIOUS content height.
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 40);
    return () => clearTimeout(t);
  }, [messages]);

  useEffect(() => {
    if (error?.code === 'entitlementRequired') onPaywall?.();
  }, [error, onPaywall]);

  const submit = () => {
    if (running) return stop();
    const text = draft;
    const photo = attachment ?? undefined;
    setDraft('');
    setAttachment(null);
    void send(text, view, photo);
  };

  const attach = () => {
    const pick = async (source: 'camera' | 'library') => setAttachment(await pickImage(source));
    if (Platform.OS !== 'ios') return void pick('library');
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Take photo', 'Choose from library', 'Cancel'], cancelButtonIndex: 2 },
      (i) => { if (i === 0) void pick('camera'); if (i === 1) void pick('library'); },
    );
  };

  const last = messages.at(-1);
  const thinking = running && (!last || last.role === 'user' || (!last.content && last.tools.length === 0));

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroller} contentContainerStyle={styles.thread} keyboardDismissMode="interactive">
        {messages.map((m) => <Bubble key={m.id} message={m} />)}
        {thinking && <ActivityIndicator style={styles.thinking} accessibilityLabel="Thinking" />}
        {error && error.code !== 'entitlementRequired' && (
          <Text style={styles.error} accessibilityRole="alert">{explainError(error.code, error.message)}</Text>
        )}
      </ScrollView>

      {attachment && (
        <View style={styles.preview}>
          <Image source={{ uri: attachment.uri }} style={styles.previewImage} />
          <Pressable onPress={() => setAttachment(null)} accessibilityLabel="Remove photo"><Text style={styles.dim}>Remove</Text></Pressable>
        </View>
      )}

      <View style={styles.composer}>
        <Pressable onPress={attach} disabled={running} style={styles.iconButton} accessibilityLabel="Attach a photo">
          <Text style={styles.icon}>＋</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask anything"
          multiline
          editable={!running}
        />
        <Pressable
          onPress={submit}
          disabled={!running && !draft.trim() && !attachment}
          style={[styles.send, running && styles.stop]}
          accessibilityLabel={running ? 'Stop' : 'Send'}
        >
          <Text style={styles.sendText}>{running ? 'Stop' : 'Send'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <View style={styles.userBubble}>
        {message.image && <Image source={{ uri: message.image }} style={styles.userImage} />}
        {!!message.content && <Text style={styles.userText}>{message.content}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.assistant}>
      {message.tools.map((t) => (
        <View key={t.callId} style={styles.tool}>
          {t.summary === undefined ? <ActivityIndicator size="small" /> : <Text style={styles.dim}>{t.failed ? '!' : '✓'}</Text>}
          <Text style={styles.dim}>{t.summary ?? TOOL_LABELS[t.name] ?? 'Working'}</Text>
        </View>
      ))}
      {!!message.content && <Markdown source={message.content} />}
      {message.proposals.map((p) => <ProposalCard key={p.id} proposal={p} />)}
      {message.cut === 'length' && <Text style={styles.dim}>The answer was cut short. Ask for the rest.</Text>}
      {message.cut === 'toolLimit' && <Text style={styles.dim}>It stopped looking things up to answer. Ask again to go further.</Text>}
    </View>
  );
}

/** Nothing has changed until Apply. Say what the card will do, in your app's words. */
function ProposalCard({ proposal }: { proposal: Proposal }) {
  const { applyProposal, dismissProposal } = useChatStore();
  const decided = proposal.outcome !== undefined;
  return (
    <View style={[styles.card, decided && styles.cardDecided]}>
      <Text style={styles.cardTitle}>{describe(proposal)}</Text>
      {decided ? (
        <Text style={styles.dim}>{proposal.outcome === 'applied' ? 'Applied' : proposal.outcome === 'failed' ? 'Could not apply: things changed' : 'Dismissed'}</Text>
      ) : (
        <View style={styles.cardActions}>
          <Pressable onPress={() => dismissProposal(proposal.id)}><Text style={styles.dim}>Dismiss</Text></Pressable>
          <Pressable onPress={() => void applyProposal(proposal.id)} style={styles.apply}><Text style={styles.sendText}>Apply</Text></Pressable>
        </View>
      )}
    </View>
  );
}

function describe(p: Proposal): string {
  // Replace with a real summary per target, from the parsed commands.
  return p.commands.length === 1 ? '1 change' : `${p.commands.length} changes`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fbfaf7' },
  thread: { padding: 16, gap: 14 },
  thinking: { alignSelf: 'flex-start' },
  error: { color: '#a3382b', fontSize: 14 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: '#1c1b19', borderRadius: 18, padding: 12, gap: 8 },
  userText: { color: '#fbfaf7', fontSize: 16, lineHeight: 22 },
  userImage: { width: 180, height: 180, borderRadius: 12 },
  assistant: { gap: 8 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dim: { color: '#6b675f', fontSize: 14 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#cfcac0', borderRadius: 14, padding: 12, gap: 10 },
  cardDecided: { opacity: 0.6 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1c1b19' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16 },
  apply: { backgroundColor: '#1c1b19', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  previewImage: { width: 56, height: 56, borderRadius: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#e4e0d8' },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22, color: '#1c1b19' },
  input: { flex: 1, maxHeight: 120, fontSize: 16, paddingVertical: 8 },
  send: { backgroundColor: '#1c1b19', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  stop: { backgroundColor: '#6b675f' },
  sendText: { color: '#fbfaf7', fontWeight: '600' },
});
