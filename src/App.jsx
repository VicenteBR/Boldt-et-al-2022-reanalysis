import React, { useState, useMemo, useRef } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area } from 'recharts';
import { Search, Trash2, BarChart2, Info, FileText, Loader2, FileCode, ExternalLink, ArrowUpDown, Camera, X, Database } from 'lucide-react';

const App = () => {
  const [fileData, setFileData] = useState({ sense: null, antisense: null });
  const [annotations, setAnnotations] = useState({});
  const [currentMode, setCurrentMode] = useState('sense');
  const [selectedGenes, setSelectedGenes] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'asc' });

  const chartRef = useRef(null);
  const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  // --- DATA PROCESSING LOGIC ---

  const processGFF = (text) => {
    const map = {};
    const lines = text.split('\n');
    lines.forEach(line => {
      if (line.startsWith('#') || line.trim() === '') return;
      const cols = line.split('\t');
      if (cols.length < 9) return;
      const attrString = cols[8];
      const attrs = {};
      attrString.split(';').forEach(pair => {
        let [key, ...rest] = pair.split('=');
        let val = rest.join('=');
        if (key && val) {
          try { attrs[key.trim()] = decodeURIComponent(val.trim()); } 
          catch (e) { attrs[key.trim()] = val.trim(); }
        }
      });
      const id = attrs['locus_tag'] || attrs['ID'];
      if (id) {
        map[id] = {
          product: attrs['product'] || attrs['description'] || "Hypothetical protein",
          geneName: attrs['Name'] || attrs['gene'] || null,
          biotype: cols[2]
        };
      }
    });
    return map;
  };

  const processData = (text) => {
    try {
      const lines = text.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#'));
      if (lines.length < 2) return null;
      const headers = lines[0].split('\t');
      const sampleCols = headers.slice(6);
      const rows = lines.slice(1).map(line => {
        const parts = line.split('\t');
        return {
          Geneid: parts[0], Chr: parts[1], Start: parts[2], End: parts[3], Strand: parts[4],
          Length: parseFloat(parts[5]),
          counts: parts.slice(6).map(val => parseFloat(val) || 0)
        };
      });
      const rpkMatrix = rows.map(row => ({
        Geneid: row.Geneid,
        meta: { Chr: row.Chr, Start: row.Start, End: row.End, Strand: row.Strand },
        rpk: row.counts.map(c => c / (row.Length / 1000 || 1))
      }));
      const sampleTotals = sampleCols.map((_, i) => rpkMatrix.reduce((sum, row) => sum + row.rpk[i], 0) / 1000000);
      const log2tpm = rpkMatrix.map(row => {
        const tpmValues = row.rpk.map((val, i) => Math.log2((val / (sampleTotals[i] || 1)) + 1));
        const entry = { Geneid: row.Geneid, ...row.meta };
        sampleCols.forEach((s, i) => { entry[s] = tpmValues[i]; });
        return entry;
      });
      const conditions = Array.from(new Set(sampleCols.map(s => s.split('_')[0]))).sort();
      return { raw: log2tpm, conditions, sampleCols, geneList: log2tpm.map(r => r.Geneid) };
    } catch (err) {
      console.error("Processing Error:", err);
      return null;
    }
  };

  // --- REMOTE FETCHING LOGIC ---

  const loadPrecomputedData = async () => {
    setIsProcessing(true);
    // CHALLENGE: Ensure these URLs point to the RAW content, not the GitHub UI.
    const BASE_RAW_URL = "https://raw.githubusercontent.com/VicenteBR/Boldt-et-al-2022-reanalysis/DATA";
    
    const files = {
      sense: `${BASE_RAW_URL}/counts_diffexpress/all_genes/sense_read_counts`,
      antisense: `${BASE_RAW_URL}/counts_diffexpress/all_genes/antisense_read_counts`,
      annotation: `${BASE_RAW_URL}/annotation_files/CP102233_annotation.gff3`
    };

    try {
      const fetchFile = async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}`);
        return res.text();
      };

      const [senseTxt, antiTxt, gffTxt] = await Promise.all([
        fetchFile(files.sense),
        fetchFile(files.antisense),
        fetchFile(files.annotation)
      ]);

      const processedSense = processData(senseTxt);
      const processedAnti = processData(antiTxt);
      const processedAnn = processGFF(gffTxt);

      if (processedSense) setFileData(prev => ({ ...prev, sense: processedSense }));
      if (processedAnti) setFileData(prev => ({ ...prev, antisense: processedAnti }));
      if (processedAnn) setAnnotations(processedAnn);
      
      setCurrentMode('both');
    } catch (err) {
      console.error("Preload Error:", err);
      // Fallback: Notify user if files are missing or CORS is blocked
    } finally {
      setIsProcessing(false);
    }
  };

  // --- UI HELPERS & DERIVED STATE ---

  const handleFileUpload = (event, mode) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (mode === 'annotation') setAnnotations(processGFF(text));
      else {
        const processed = processData(text);
        if (processed) setFileData(prev => ({ ...prev, [mode]: processed }));
      }
      setIsProcessing(false);
    };
    reader.readAsText(file);
  };

  const listSource = useMemo(() => fileData.sense || fileData.antisense, [fileData]);

  const aggregatedData = useMemo(() => {
    if (selectedGenes.length === 0) return [];
    const conditions = fileData.sense?.conditions || fileData.antisense?.conditions || [];
    return conditions.map(cond => {
      const point = { condition: cond };
      selectedGenes.forEach(geneId => {
        ['sense', 'antisense'].forEach(m => {
          if (currentMode === m || currentMode === 'both') {
            const dataObj = fileData[m];
            const geneRow = dataObj?.raw.find(r => r.Geneid === geneId);
            if (geneRow) {
              const relevantSamples = dataObj.sampleCols.filter(s => s.startsWith(cond));
              const values = relevantSamples.map(s => geneRow[s]);
              const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
              const std = Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / (values.length || 1));
              const key = currentMode === 'both' ? `${geneId}_${m[0].toUpperCase()}` : geneId;
              point[`${key}_mean`] = mean;
              point[`${key}_range`] = [Math.max(0, mean - std), mean + std];
            }
          }
        });
      });
      return point;
    });
  }, [fileData, selectedGenes, currentMode]);

  const filteredGenes = useMemo(() => {
    if (!listSource) return [];
    const term = searchTerm.toLowerCase();
    let genes = listSource.geneList.filter(g => {
      const ann = annotations[g];
      return g.toLowerCase().includes(term) || ann?.product?.toLowerCase().includes(term) || ann?.geneName?.toLowerCase().includes(term);
    });

    if (sortConfig.key === 'expression' && fileData.sense) {
      const exprMap = new Map();
      fileData.sense.raw.forEach(row => {
        const mean = fileData.sense.sampleCols.reduce((s, c) => s + row[c], 0) / fileData.sense.sampleCols.length;
        exprMap.set(row.Geneid, mean);
      });
      genes.sort((a, b) => (sortConfig.direction === 'asc' ? 1 : -1) * ((exprMap.get(b) || 0) - (exprMap.get(a) || 0)));
    } else {
      genes.sort((a, b) => {
        const valA = sortConfig.key === 'id' ? a : (annotations[a]?.product || a);
        const valB = sortConfig.key === 'id' ? b : (annotations[b]?.product || b);
        return (sortConfig.direction === 'asc' ? 1 : -1) * valA.localeCompare(valB);
      });
    }
    return genes.slice(0, 100);
  }, [listSource, searchTerm, annotations, sortConfig, fileData.sense]);

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-lg shadow-md"><BarChart2 className="text-white w-6 h-6" /></div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">RNA-Seq Browser</h1>
            {listSource && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-indigo-100 text-indigo-700">{currentMode} view</span>}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {!listSource && !isProcessing && (
            <button 
              onClick={loadPrecomputedData}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-all shadow-md text-sm font-bold animate-pulse hover:animate-none"
            >
              <Database size={16} /> Load Reanalysis Dataset
            </button>
          )}

          {(!fileData.sense || !fileData.antisense) && !isProcessing && (
            <div className="flex gap-2">
              {!fileData.sense && <label className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium"><FileText size={14} />Sense<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'sense')} /></label>}
              {!fileData.antisense && <label className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium"><FileText size={14} />Antisense<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'antisense')} /></label>}
            </div>
          )}

          {isProcessing && <div className="flex items-center gap-2 text-blue-600 text-sm font-medium"><Loader2 className="animate-spin" size={16} />Processing...</div>}
          
          {listSource && (
            <div className="flex items-center gap-2">
               <button onClick={() => { setFileData({sense:null, antisense:null}); setAnnotations({}); setSelectedGenes([]); }} className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors"><Trash2 size={18} /></button>
            </div>
          )}
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-sm">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input type="text" placeholder="Search genes..." className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} disabled={!listSource} />
            </div>
            {listSource && (
              <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                <span>Sort:</span>
                <div className="flex gap-1">
                  {['id', 'name', 'expression'].map(k => (
                    <button key={k} onClick={() => setSortConfig(p => ({key: k, direction: p.key===k && p.direction==='asc'?'desc':'asc'}))} className={`px-2 py-1 rounded ${sortConfig.key===k?'bg-blue-50 text-blue-700':'hover:bg-slate-100'}`}>{k}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {filteredGenes.map(gene => (
              <button key={gene} onClick={() => setSelectedGenes(prev => prev.includes(gene) ? prev.filter(g=>g!==gene) : prev.length<7 ? [...prev, gene] : prev)} className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-all ${selectedGenes.includes(gene) ? 'bg-blue-50 border-blue-100' : 'hover:bg-slate-50 border-transparent'} border`}>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-xs font-bold">{gene}</span>
                  {annotations[gene]?.geneName && <span className="text-[10px] text-slate-400">{annotations[gene].geneName}</span>}
                </div>
                <div className="text-[10px] text-slate-500 truncate">{annotations[gene]?.product || "---"}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto bg-slate-50/30">
          {selectedGenes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300">
              <Database size={64} className="mb-4 opacity-20" />
              <p className="font-medium text-slate-400">Select genes or load the dataset above</p>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex justify-between mb-8">
                  <h2 className="text-xl font-black text-slate-800">Expression Profile <span className="text-sm font-normal text-slate-400 ml-2">log2(TPM+1)</span></h2>
                  <button onClick={() => {
                    const svg = document.querySelector('.recharts-wrapper svg');
                    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type:'image/svg+xml'}));
                    const a = document.createElement('a'); a.href=url; a.download='plot.svg'; a.click();
                  }} className="p-2 bg-slate-50 rounded-lg text-slate-500 hover:text-blue-600"><Camera size={18}/></button>
                </div>

                <div className="h-[450px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={aggregatedData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="condition" axisLine={false} tickLine={false} tick={{fill:'#64748b', fontSize:11}} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill:'#64748b', fontSize:11}} />
                      <Tooltip contentStyle={{borderRadius:'12px', border:'none', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.1)'}} 
                               formatter={(v, n) => [Array.isArray(v)?`${v[0].toFixed(2)}-${v[1].toFixed(2)}`:v.toFixed(2), n]} />
                      
                      {selectedGenes.flatMap((gene, i) => {
                        const c = colors[i % colors.length];
                        const keys = currentMode === 'both' ? [`${gene}_S`, `${gene}_A`] : [gene];
                        return keys.map((k, j) => (
                          <React.Fragment key={k}>
                            <Area dataKey={`${k}_range`} stroke="none" fill={c} fillOpacity={j===0?0.15:0.05} connectNulls />
                            <Line dataKey={`${k}_mean`} name={k} stroke={c} strokeWidth={j===0?3:2} strokeDasharray={j===1?"5 5":""} dot={{r:3}} connectNulls />
                          </React.Fragment>
                        ));
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;