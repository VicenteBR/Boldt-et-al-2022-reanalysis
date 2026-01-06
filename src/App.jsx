import React, { useState, useMemo, useRef } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area } from 'recharts';
import { Search, Trash2, BarChart2, Info, FileText, Loader2, FileCode, ExternalLink, ArrowUpDown, Camera, X, Database, Settings } from 'lucide-react';

// --- CONFIGURATION ---
// Update these values to point to your data on GitHub
const REMOTE_CONFIG = {
  enabled: true,
  username: "VicenteBR", 
  repo: "Boldt-et-al-2022-reanalysis",
  branch: "main",
  folder: "DATA",
  files: {
    sense: "/counts_diffexpress/sense_read_counts",
    antisense: "/counts_diffexpress/antisense_read_counts",
    annotation: "/annotation_files/CP102233_annotation.gff3"
  }
};

const App = () => {
  const [fileData, setFileData] = useState({ sense: null, antisense: null });
  const [annotations, setAnnotations] = useState({});
  const [currentMode, setCurrentMode] = useState('sense'); // 'sense' | 'antisense' | 'both'
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
      if (!text) return null;
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
      // Natural sort for conditions (T1, T2, T10)
      const conditions = Array.from(new Set(sampleCols.map(s => s.split('_')[0])))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
      
      return { raw: log2tpm, conditions, sampleCols, geneList: log2tpm.map(r => r.Geneid) };
    } catch (err) {
      console.error("Processing Error:", err);
      return null;
    }
  };

  // --- REMOTE FETCHING ---

  const loadPrecomputedData = async () => {
    setIsProcessing(true);
    const { username, repo, branch, folder, files } = REMOTE_CONFIG;
    // Construct base URL and ensure no trailing slash
    const base = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${folder}`.replace(/\/$/, "");
    
    try {
      const fetchF = async (path) => {
        const cleanPath = path.startsWith('/') ? path.substring(1) : path;
        const res = await fetch(`${base}/${cleanPath}`);
        if (!res.ok) throw new Error(`404: ${cleanPath} not found.`);
        return res.text();
      };

      // Use try-catch inside each fetch to allow partial loads if one file fails
      const results = await Promise.allSettled([
        fetchF(files.sense),
        fetchF(files.antisense),
        fetchF(files.annotation)
      ]);

      const sTxt = results[0].status === 'fulfilled' ? results[0].value : null;
      const aTxt = results[1].status === 'fulfilled' ? results[1].value : null;
      const gTxt = results[2].status === 'fulfilled' ? results[2].value : null;

      const sData = processData(sTxt);
      const aData = processData(aTxt);
      const ann = gTxt ? processGFF(gTxt) : {};

      if (sData) setFileData(p => ({ ...p, sense: sData }));
      if (aData) setFileData(p => ({ ...p, antisense: aData }));
      if (Object.keys(ann).length > 0) setAnnotations(ann);
      
      if (sData || aData) {
        setCurrentMode(sData && aData ? 'both' : (sData ? 'sense' : 'antisense'));
      }
    } catch (err) {
      console.error("Critical Load Error:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- UI HELPERS ---

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
        if (processed) {
            setFileData(prev => ({ ...prev, [mode]: processed }));
            if (currentMode === 'sense' && mode === 'antisense' && !fileData.sense) setCurrentMode('antisense');
        }
      }
      setIsProcessing(false);
    };
    reader.readAsText(file);
  };

  const listSource = useMemo(() => fileData.sense || fileData.antisense, [fileData]);

  const aggregatedData = useMemo(() => {
    if (selectedGenes.length === 0) return [];
    const conds = Array.from(new Set([
        ...(fileData.sense?.conditions || []),
        ...(fileData.antisense?.conditions || [])
    ])).sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));

    return conds.map(cond => {
      const point = { condition: cond };
      selectedGenes.forEach(geneId => {
        ['sense', 'antisense'].forEach(m => {
          if (currentMode === m || currentMode === 'both') {
            const dataObj = fileData[m];
            const geneRow = dataObj?.raw.find(r => r.Geneid === geneId);
            if (geneRow) {
              const relevantSamples = dataObj.sampleCols.filter(s => s.startsWith(cond));
              const values = relevantSamples.map(s => geneRow[s]).filter(v => !isNaN(v));
              if (values.length > 0) {
                const mean = values.reduce((a, b) => a + b, 0) / values.length;
                const std = Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / values.length);
                const key = currentMode === 'both' ? `${geneId}_${m[0].toUpperCase()}` : geneId;
                point[`${key}_mean`] = mean;
                point[`${key}_range`] = [Math.max(0, mean - std), mean + std];
              }
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
        const mean = fileData.sense.sampleCols.reduce((s, c) => s + (row[c] || 0), 0) / fileData.sense.sampleCols.length;
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
            {listSource && (
                <div className="flex gap-1 mt-1">
                    {['sense', 'antisense', 'both'].map(m => (
                        <button 
                            key={m} 
                            disabled={m === 'both' ? (!fileData.sense || !fileData.antisense) : !fileData[m]}
                            onClick={() => setCurrentMode(m)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${currentMode === m ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-30'}`}
                        >
                            {m}
                        </button>
                    ))}
                </div>
            )}
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

          {!isProcessing && (
            <div className="flex gap-2">
              <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium border transition-colors ${fileData.sense ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                <FileText size={14} />{fileData.sense ? 'Sense Loaded' : 'Sense'}<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'sense')} />
              </label>
              <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium border transition-colors ${fileData.antisense ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                <FileText size={14} />{fileData.antisense ? 'Anti Loaded' : 'Antisense'}<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'antisense')} />
              </label>
              <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium border transition-colors ${Object.keys(annotations).length > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                <FileCode size={14} />GFF3<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'annotation')} />
              </label>
            </div>
          )}

          {isProcessing && <div className="flex items-center gap-2 text-blue-600 text-sm font-medium"><Loader2 className="animate-spin" size={16} />Processing...</div>}
          
          {listSource && (
            <button onClick={() => { setFileData({sense:null, antisense:null}); setAnnotations({}); setSelectedGenes([]); }} className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors ml-2" title="Clear all data"><Trash2 size={18} /></button>
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
                    <button key={k} onClick={() => setSortConfig(p => ({key: k, direction: p.key===k && p.direction==='asc'?'desc':'asc'}))} className={`px-2 py-1 rounded transition-colors ${sortConfig.key===k?'bg-blue-600 text-white':'bg-slate-100 hover:bg-slate-200'}`}>{k}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
            {filteredGenes.map(gene => (
              <button key={gene} onClick={() => setSelectedGenes(prev => prev.includes(gene) ? prev.filter(g=>g!==gene) : prev.length<7 ? [...prev, gene] : prev)} className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-all ${selectedGenes.includes(gene) ? 'bg-blue-50 border-blue-200 shadow-sm' : 'hover:bg-slate-50 border-transparent'} border`}>
                <div className="flex justify-between items-center">
                  <span className={`font-mono text-xs font-bold ${selectedGenes.includes(gene) ? 'text-blue-700' : 'text-slate-700'}`}>{gene}</span>
                  {annotations[gene]?.geneName && <span className="text-[10px] bg-slate-100 px-1 rounded text-slate-500">{annotations[gene].geneName}</span>}
                </div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5">{annotations[gene]?.product || "---"}</div>
              </button>
            ))}
            {listSource && filteredGenes.length === 0 && <div className="text-center py-8 text-slate-400 text-xs italic">No genes found.</div>}
          </div>
          
          {selectedGenes.length > 0 && (
              <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-1">
                  {selectedGenes.map((g, i) => (
                      <div key={g} className="bg-white border border-slate-200 px-2 py-0.5 rounded text-[10px] flex items-center gap-1 shadow-xs">
                          <div className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: colors[i % colors.length]}} />
                          <span className="max-w-[80px] truncate font-medium">{g}</span>
                          <button onClick={() => setSelectedGenes(p => p.filter(x=>x!==g))} className="text-slate-300 hover:text-red-500"><X size={10} /></button>
                      </div>
                  ))}
              </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto bg-slate-50/30">
          {selectedGenes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300">
              <Database size={64} className="mb-4 opacity-10" />
              <p className="font-bold text-slate-400 uppercase tracking-widest text-sm">Select genes to begin</p>
              <p className="text-slate-300 text-xs mt-2">Maximum 7 genes can be visualized simultaneously</p>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 relative">
                <div className="flex justify-between items-center mb-10">
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Expression Profile</h2>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Unit: <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">log2(TPM + 1)</span></p>
                  </div>
                  <button onClick={() => {
                    const svg = document.querySelector('.recharts-wrapper svg');
                    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type:'image/svg+xml'}));
                    const a = document.createElement('a'); a.href=url; a.download=`rnaseq_plot_${new Date().getTime()}.svg`; a.click();
                  }} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-900 transition-all shadow-md active:scale-95"><Camera size={16}/>Export SVG</button>
                </div>

                <div className="h-[480px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={aggregatedData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="condition" axisLine={false} tickLine={false} tick={{fill:'#64748b', fontSize:11, fontWeight:600}} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill:'#64748b', fontSize:11}} width={35} />
                      <Tooltip 
                        contentStyle={{borderRadius:'16px', border:'none', boxShadow:'0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)', padding:'16px'}} 
                        formatter={(v, n) => {
                            if (Array.isArray(v)) return [`${v[0]?.toFixed(2)} - ${v[1]?.toFixed(2)}`, n];
                            return [v?.toFixed(2) || '0.00', n];
                        }} 
                      />
                      
                      {selectedGenes.flatMap((gene, i) => {
                        const c = colors[i % colors.length];
                        const keys = currentMode === 'both' ? [`${gene}_S`, `${gene}_A`] : [gene];
                        return keys.map((k, j) => (
                          <React.Fragment key={k}>
                            <Area dataKey={`${k}_range`} stroke="none" fill={c} fillOpacity={j===0?0.15:0.05} connectNulls />
                            <Line 
                                dataKey={`${k}_mean`} 
                                name={currentMode === 'both' ? (j === 0 ? `${gene} (Sense)` : `${gene} (Antisense)`) : gene} 
                                stroke={c} 
                                strokeWidth={j===0?3:2} 
                                strokeDasharray={j===1?"5 5":""} 
                                dot={{r:3, fill: j===0?c:'#fff', strokeWidth: 2}} 
                                connectNulls 
                            />
                          </React.Fragment>
                        ));
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                
                <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {selectedGenes.map((g, i) => (
                        <div key={g} className="text-xs p-3 rounded-xl border border-slate-100 bg-slate-50/50">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="w-2 h-2 rounded-full" style={{backgroundColor: colors[i % colors.length]}} />
                                <span className="font-bold">{g}</span>
                                <a href={`https://www.ncbi.nlm.nih.gov/gene/?term=${g}`} target="_blank" className="ml-auto text-slate-300 hover:text-indigo-500"><ExternalLink size={12}/></a>
                            </div>
                            <p className="text-[10px] text-slate-500 line-clamp-2 italic">{annotations[g]?.product || 'No annotation available'}</p>
                        </div>
                    ))}
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