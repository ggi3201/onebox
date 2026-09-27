/**
 * Blocks to React Native. Replace the colors and sizes in `styles` with your
 * theme tokens; the structure is the part to keep.
 */
import { memo, useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { parseMarkdown, type Block, type Span } from './parseMarkdown';

export const Markdown = memo(function Markdown({ source }: { source: string }) {
  // Parsed per render of THIS message only (memo), not for the whole list.
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <View style={styles.root}>
      {blocks.map((b, i) => <BlockView key={i} block={b} />)}
    </View>
  );
});

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'paragraph':
      return <Text style={styles.body}><Spans spans={block.spans} /></Text>;
    case 'heading':
      return <Text style={[styles.body, styles.heading]}><Spans spans={block.spans} /></Text>;
    case 'bullets':
    case 'ordered':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text style={styles.marker}>{block.kind === 'ordered' ? `${i + 1}.` : '•'}</Text>
              <Text style={[styles.body, styles.itemText]}><Spans spans={item} /></Text>
            </View>
          ))}
        </View>
      );
    case 'table':
      // Scroll sideways rather than squeeze: a date wrapped mid-string makes a table unreadable.
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} directionalLockEnabled>
          <View>
            {[block.head, ...block.rows].map((row, r) => (
              <View key={r} style={[styles.row, r === 0 && styles.headRow]}>
                {row.map((cell, c) => (
                  <Text key={c} style={[styles.cell, r === 0 && styles.headCell]} numberOfLines={2}>
                    <Spans spans={cell} />
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    case 'code':
      return <View style={styles.code}><Text style={styles.codeText}>{block.text}</Text></View>;
    case 'rule':
      return <View style={styles.rule} />;
  }
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        switch (s.kind) {
          case 'text': return <Text key={i}>{s.text}</Text>;
          case 'strong': return <Text key={i} style={styles.strong}>{s.text}</Text>;
          case 'em': return <Text key={i} style={styles.em}>{s.text}</Text>;
          case 'code': return <Text key={i} style={styles.inlineCode}>{s.text}</Text>;
          case 'link': return <Text key={i} style={styles.link} onPress={() => open(s.href)}>{s.text}</Text>;
        }
      })}
    </>
  );
}

/**
 * http(s) only. Links can come from web pages written by strangers, and other
 * schemes reach things that are not pages: `tel:` dials, `sms:` composes,
 * custom schemes open other apps.
 */
function open(href: string) {
  if (/^https?:\/\//i.test(href)) void Linking.openURL(href).catch(() => {});
}

const INK = '#1c1b19';
const DIM = '#6b675f';
const LINE = '#e4e0d8';

const styles = StyleSheet.create({
  root: { gap: 10 },
  body: { fontSize: 16, lineHeight: 23, color: INK },
  heading: { fontWeight: '600' },
  list: { gap: 4 },
  item: { flexDirection: 'row', gap: 8 },
  marker: { fontSize: 16, lineHeight: 23, color: DIM, minWidth: 16, fontVariant: ['tabular-nums'] },
  itemText: { flex: 1 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: LINE },
  headRow: { borderColor: DIM },
  cell: { width: 110, paddingVertical: 6, paddingRight: 12, fontSize: 14, color: INK, fontVariant: ['tabular-nums'] },
  headCell: { fontWeight: '600', color: DIM },
  code: { backgroundColor: '#f4f2ee', borderRadius: 8, padding: 10 },
  codeText: { fontFamily: 'Menlo', fontSize: 13, color: INK },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: LINE },
  strong: { fontWeight: '600' },
  em: { fontStyle: 'italic' },
  inlineCode: { fontFamily: 'Menlo', fontSize: 14 },
  link: { textDecorationLine: 'underline' },
});
