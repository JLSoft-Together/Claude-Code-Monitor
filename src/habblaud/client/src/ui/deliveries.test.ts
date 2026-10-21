import { describe, expect, it } from 'vitest';
import { arrivals, fileUrl, parseDeliveries, projectName, unseenCount, workLine } from './deliveries';

const d = (id: string, finishedAt: number, extra: object = {}) => ({ id, headline: 'h', text: 't', finishedAt, startedAt: finishedAt - 600_000, tools: 3, edited: 0, attachments: [], request: '', account: 'a', sessionId: 's', ...extra });

describe('entregas no navegador', () => {
  it('valida a resposta e descarta anexo com id ou tipo estranho', () => {
    const list = parseDeliveries({ deliveries: [d('1', 10, { attachments: [{ id: 'abcdef1234', name: 'a.png', kind: 'image' }, { id: '../x', name: 'b', kind: 'image' }, { id: 'abcdef1234', name: 'c', kind: 'exe' }] }), { id: 2 }] });
    expect(list).toHaveLength(1);
    expect(list[0].attachments.map((a) => a.name)).toEqual(['a.png']);
    expect(parseDeliveries(null)).toEqual([]);
  });
  it('novas desde a última vez, chegadas para o aviso, linha do trabalho', () => {
    const list = parseDeliveries({ deliveries: [d('1', 300), d('2', 200), d('3', 100)] });
    expect(unseenCount(list, 150)).toBe(2);
    expect(arrivals(list, 0)).toEqual([]);
    expect(arrivals(list, 250).map((x) => x.id)).toEqual(['1']);
    expect(workLine({ tools: 1, edited: 2, startedAt: 0, finishedAt: 12 * 60_000 })).toBe('1 passo · 2 arquivos alterados · 12 min');
    expect(workLine({ tools: 4, edited: 0, startedAt: 0, finishedAt: 5_000 })).toBe('4 passos');
    expect(fileUrl({ id: 'ab12' })).toBe('/api/deliveries/file/ab12');
    expect(projectName('/Users/a/Coding/proj/')).toBe('proj');
  });
});
