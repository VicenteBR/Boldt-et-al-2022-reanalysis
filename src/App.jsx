import React, { useState, useMemo, useRef } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area } from 'recharts';
import { Search, Trash2, BarChart2, Info, FileText, Loader2, FileCode, ExternalLink, ArrowUpDown, X, Database, AlertCircle, Table, ShieldCheck, HelpCircle } from 'lucide-react';

// --- CONFIGURATION ---
const REMOTE_CONFIG = {
  reanalysis: {
    username: "VicenteBR", 
    repo: "Boldt-et-al-2022-reanalysis",
    branch: "main",
    folder: "DATA",
    files: {
      sense: "/counts_diffexpress/all_genes/sense_read_counts",
      antisense: "/counts_diffexpress/all_genes/antisense_read_counts",
      annotation: "/annotation_files/CP102233_annotation.gff3"
    }
  },
  defense: {
    username: "VicenteBR", 
    repo: "Boldt-et-al-2022-reanalysis",
    branch: "main",
    folder: "DATA",
    files: {
      sense: "/counts_diffexpress/defense_systems/defense_read_counts", 
      annotation: "/annotation_files/CP102233_padloc.gff" 
    }
  }
};

const CustomTooltip = ({ active, payload, label, annotations }) => {
  if (!active || !payload || !payload.length) return null;

  try {
    const grouped = {};
    payload.forEach(item => {
      if (!item || !item.name) return;
      const geneId = item.name.split(' (')[0];
      if (!grouped[geneId]) grouped[geneId] = [];
      grouped[geneId].push(item);
    });

    return (
      <div className="bg-white p-4 rounded-2xl shadow-2xl border border-slate-100 min-w-[220px] z-50">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 border-b pb-2">{label || 'Unknown Timepoint'}</p>
        <div className="space-y-4">
          {Object.entries(grouped).map(([geneId, items]) => {
            const ann = annotations?.[geneId];
            return (
              <div key={geneId}>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: items[0]?.color || '#cbd5e1' }} />
                  <p className="text-sm font-bold text-slate-800">
                    {ann?.geneName || geneId}
                  </p>
                </div>
                <div className="space-y-1 pl-4">
                  {items.map((item, idx) => {
                    const itemName = item?.name || "";
                    const isD1 = itemName.includes('D1') || itemName.includes('Sense') || (!itemName.includes('D2') && !itemName.includes('Antisense'));
                    return (
                      <div key={idx} className="text-[11px] font-medium text-slate-500 flex justify-between gap-4">
                        <span>{isD1 ? 'Dataset 1' : 'Dataset 2'}:</span>
                        <span className="font-mono font-bold text-slate-700">
                          {typeof item?.value === 'number' && !isNaN(item.value) ? item.value.toFixed(2) : 'N/A'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  } catch (err) {
    return null; 
  }
};

const App = () => {
  const [fileData, setFileData] = useState({ sense: null, antisense: null });
  const [annotations, setAnnotations] = useState({});
  const [currentMode, setCurrentMode] = useState('sense'); 
  const [selectedGenes, setSelectedGenes] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPrecomputed, setIsPrecomputed] = useState(false);
  const [loadStatus, setLoadStatus] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'asc' });

  const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  const processGFF = (text) => {
    if (!text || text.includes('<!DOCTYPE html>')) return {};
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

      const id_attr = attrs['ID'];
      const locus = attrs['locus_tag'];
      const name = attrs['Name'] || attrs['gene'];
      let system = null;
      if (attrs['Note'] && attrs['Note'].startsWith('system:')) {
        system = attrs['Note'].replace('system:', '');
      }
      const product = attrs['product'] || attrs['description'] || (system ? `Defense system: ${system}` : null) || attrs['Note'] || "Hypothetical protein";
      const entry = { product, geneName: name, system: system, locus: locus || id_attr };
      if (id_attr) map[id_attr] = entry;
      if (locus) map[locus] = entry;
      if (name) map[name] = entry;
    });
    return map;
  };

  const processData = (text) => {
    try {
      if (!text || text.includes('<!DOCTYPE html>')) return null;
      const lines = text.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#'));
      if (lines.length < 2) return null;
      const headers = lines[0].split('\t');
      if (headers.length < 7) return null; 
      const sampleCols = headers.slice(6);
      const rows = lines.slice(1).map(line => {
        const parts = line.split('\t');
        return {
          Geneid: parts[0], Chr: parts[1], Start: parts[2], End: parts[3], Strand: parts[4],
          Length: parseFloat(parts[5]),
          counts: parts.slice(6).map(val => parseFloat(val) || 0)
        };
      });
      const rawCounts = rows.map(row => {
        const entry = { Geneid: row.Geneid };
        sampleCols.forEach((s, i) => { entry[s] = row.counts[i]; });
        return entry;
      });
      const rpkMatrix = rows.map(row => ({
        Geneid: row.Geneid,
        rpk: row.counts.map(c => c / (row.Length / 1000 || 1))
      }));
      const sampleTotals = sampleCols.map((_, i) => rpkMatrix.reduce((sum, row) => sum + row.rpk[i], 0) / 1000000);
      const log2tpm = rpkMatrix.map((row, idx) => {
        const tpmValues = row.rpk.map((val, i) => Math.log2((val / (sampleTotals[i] || 1)) + 1));
        const entry = { Geneid: row.Geneid, Chr: rows[idx].Chr, Strand: rows[idx].Strand };
        sampleCols.forEach((s, i) => { entry[s] = tpmValues[i]; });
        return entry;
      });
      const conditions = Array.from(new Set(sampleCols.map(s => s.split('_')[0])))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
      return { raw: log2tpm, rawCounts, conditions, sampleCols, geneList: log2tpm.map(r => r.Geneid) };
    } catch (err) { return null; }
  };

  const loadDataFromRemote = async (type) => {
    setIsProcessing(true);
    setLoadStatus(null);
    const config = REMOTE_CONFIG[type];
    const base = `https://raw.githubusercontent.com/${config.username}/${config.repo}/${config.branch}/${config.folder}`.replace(/\/$/, "");
    
    try {
      const fetchF = async (path) => {
        if (!path) return null;
        const cleanPath = path.startsWith('/') ? path.substring(1) : path;
        const res = await fetch(`${base}/${cleanPath}`);
        if (!res.ok) throw new Error(`${path} not found`);
        return res.text();
      };
      const [sTxt, aTxt, gTxt] = await Promise.all([
        fetchF(config.files.sense),
        fetchF(config.files.antisense),
        fetchF(config.files.annotation)
      ]);
      const sData = processData(sTxt);
      const aData = processData(aTxt);
      const ann = processGFF(gTxt);
      setFileData({ sense: sData, antisense: aData });
      setAnnotations(ann);
      setSelectedGenes([]);
      setIsPrecomputed(true);
      setCurrentMode(sData && aData ? 'both' : (sData ? 'sense' : 'antisense'));
      setLoadStatus({ type: 'info', msg: `${type === 'reanalysis' ? 'Full Reanalysis' : 'Defense Systems'} loaded.` });
    } catch (err) { setLoadStatus({ type: 'error', msg: err.message }); } finally { setIsProcessing(false); }
  };

  const handleFileUpload = (event, mode) => {
    if (isPrecomputed) return;
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

  const fullStats = useMemo(() => {
    if (selectedGenes.length === 0) return [];
    const conds = Array.from(new Set([
        ...(fileData.sense?.conditions || []),
        ...(fileData.antisense?.conditions || [])
    ])).sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));

    return conds.map(cond => {
      const entry = { condition: cond, genes: {} };
      selectedGenes.forEach(geneId => {
        entry.genes[geneId] = { sense: null, antisense: null };
        ['sense', 'antisense'].forEach(m => {
          const dataObj = fileData[m];
          const tpmRow = dataObj?.raw.find(r => r.Geneid === geneId);
          const countRow = dataObj?.rawCounts.find(r => r.Geneid === geneId);
          if (tpmRow && countRow) {
            const relevantSamples = dataObj.sampleCols.filter(s => s.startsWith(cond));
            const tpmVals = relevantSamples.map(s => tpmRow[s]).filter(v => typeof v === 'number' && !isNaN(v));
            const countVals = relevantSamples.map(s => countRow[s]).filter(v => typeof v === 'number' && !isNaN(v));
            
            if (tpmVals.length > 0) {
              const tpmMean = tpmVals.reduce((a, b) => a + b, 0) / tpmVals.length;
              const tpmStd = Math.sqrt(tpmVals.map(x => Math.pow(x - tpmMean, 2)).reduce((a, b) => a + b, 0) / tpmVals.length);
              entry.genes[geneId][m] = { tpmMean, tpmStd, countMean: countVals.length > 0 ? countVals.reduce((a, b) => a + b, 0) / countVals.length : 0 };
              
              // FIX: Ensure iterating over strands doesn't overwrite shared keys in Dataset 1 vs Dataset 2 modes
              if (currentMode === 'both') {
                const suffix = m === 'sense' ? 'S' : 'A';
                entry[`${geneId}_${suffix}_mean`] = tpmMean;
                entry[`${geneId}_${suffix}_range`] = [Math.max(0, tpmMean - tpmStd), tpmMean + tpmStd];
              } else if (currentMode === m) {
                entry[`${geneId}_mean`] = tpmMean;
                entry[`${geneId}_range`] = [Math.max(0, tpmMean - tpmStd), tpmMean + tpmStd];
              }
            }
          }
        });
      });
      return entry;
    });
  }, [fileData, selectedGenes, currentMode]);

  const filteredGenes = useMemo(() => {
    if (!listSource) return [];
    const term = searchTerm.toLowerCase();
    let genes = listSource.geneList.filter(g => {
      const ann = annotations[g];
      return g.toLowerCase().includes(term) || ann?.product?.toLowerCase().includes(term) || ann?.geneName?.toLowerCase().includes(term) || ann?.system?.toLowerCase().includes(term);
    });
    if (sortConfig.key === 'expression' && fileData.sense) {
      const exprMap = new Map();
      fileData.sense.raw.forEach(row => {
        const mean = fileData.sense.sampleCols.reduce((s, c) => s + (row[c] || 0), 0) / fileData.sense.sampleCols.length;
        exprMap.set(row.Geneid, mean);
      });
      genes.sort((a, b) => (sortConfig.direction === 'asc' ? 1 : -1) * ((exprMap.get(b) || 0) - (exprMap.get(a) || 0)));
    } else {
      genes.sort((a, b) => (sortConfig.direction === 'asc' ? 1 : -1) * (sortConfig.key === 'id' ? a : (annotations[a]?.product || a)).localeCompare(sortConfig.key === 'id' ? b : (annotations[b]?.product || b)));
    }
    return genes.slice(0, 100);
  }, [listSource, searchTerm, annotations, sortConfig, fileData.sense]);

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-lg shadow-md"><BarChart2 className="text-white w-6 h-6" /></div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">RNA-Seq Browser</h1>
            {listSource && (
                <div className="flex gap-1 mt-1">
                    {['sense', 'antisense', 'both'].map(m => (
                        <button key={m} disabled={m === 'both' ? (!fileData.sense || !fileData.antisense) : !fileData[m]} onClick={() => setCurrentMode(m)} className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${currentMode === m ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-30'}`}>
                            {m === 'both' ? 'Compare' : m === 'sense' ? 'Dataset 1' : 'Dataset 2'}
                        </button>
                    ))}
                </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {loadStatus && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold animate-in fade-in slide-in-from-top-1 ${loadStatus.type === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>
              {loadStatus.type === 'error' ? <AlertCircle size={14} /> : <Info size={14} />}
              {loadStatus.msg}
              <button onClick={() => setLoadStatus(null)} className="ml-1 opacity-50 hover:opacity-100"><X size={12} /></button>
            </div>
          )}

          {!listSource && !isProcessing && (
            <div className="flex gap-2">
              <button onClick={() => loadDataFromRemote('reanalysis')} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-all shadow-md text-sm font-bold">
                <Database size={16} /> Reanalysis
              </button>
              <button onClick={() => loadDataFromRemote('defense')} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-all shadow-md text-sm font-bold">
                <ShieldCheck size={16} /> Defense Systems
              </button>
            </div>
          )}

          <div className={`flex gap-2 transition-opacity ${isPrecomputed ? 'opacity-30 pointer-events-none' : ''}`}>
            <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium border transition-colors ${fileData.sense ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-400 border-slate-200'}`}>
              <FileText size={14} />{fileData.sense ? 'D1 Loaded' : 'Dataset 1'}<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'sense')} disabled={isPrecomputed} />
            </label>
            <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium border transition-colors ${fileData.antisense ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-white text-slate-400 border-slate-200'}`}>
              <FileText size={14} />{fileData.antisense ? 'D2 Loaded' : 'Dataset 2'}<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'antisense')} disabled={isPrecomputed} />
            </label>
            <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium border transition-colors ${Object.keys(annotations).length > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-slate-400 border-slate-200'}`}>
              <FileCode size={14} />GFF3<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'annotation')} disabled={isPrecomputed} />
            </label>
          </div>

          {listSource && (
            <button onClick={() => { setFileData({sense:null, antisense:null}); setAnnotations({}); setSelectedGenes([]); setIsPrecomputed(false); setLoadStatus(null); }} className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors ml-2" title="Reset Browser"><Trash2 size={18} /></button>
          )}
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input type="text" placeholder="Search ID, Name, or System..." className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} disabled={!listSource} />
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
                <div className="flex items-center gap-2 mt-0.5">
                    {annotations[gene]?.system && <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1 rounded font-bold">{annotations[gene].system}</span>}
                    <div className="text-[10px] text-slate-400 truncate">{annotations[gene]?.product || "---"}</div>
                </div>
              </button>
            ))}
          </div>
          
          {selectedGenes.length > 0 && (
              <div className="p-3 bg-slate-50 border-t border-slate-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Selected ({selectedGenes.length})</span>
                    <button onClick={() => setSelectedGenes([])} className="text-[10px] font-bold text-red-500 hover:underline">Clear All</button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedGenes.map((g, i) => (
                        <div key={g} className="bg-white border border-slate-200 px-2 py-0.5 rounded text-[10px] flex items-center gap-1 shadow-xs">
                            <div className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: colors[i % colors.length]}} />
                            <span className="max-w-[80px] truncate font-medium">{annotations[g]?.geneName || g}</span>
                        </div>
                    ))}
                  </div>
              </div>
          )}
        </div>

        <div className="flex-1 p-8 overflow-y-auto bg-slate-50/30 scrollbar-thin">
          {!listSource ? (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
              <div className="bg-white p-12 rounded-3xl border border-slate-200 shadow-sm">
                <div className="flex flex-col items-center text-center mb-10">
                    <Database size={48} className="text-indigo-600 mb-4 opacity-40" />
                    <h2 className="text-3xl font-black text-slate-800 tracking-tight">Getting Started</h2>
                    <p className="text-slate-500 max-w-lg mt-2">Load precomputed datasets or upload your own files below to begin visualization.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                  <div className="p-6 bg-blue-50/50 rounded-3xl border border-blue-100">
                    <h3 className="font-bold text-blue-900 flex items-center gap-2 mb-3"><FileText size={20}/> Count File (.tsv)</h3>
                    <div className="text-[11px] font-mono bg-white p-3 rounded-xl border border-blue-100 text-blue-800 mb-4 overflow-x-auto whitespace-nowrap">
                        Geneid Chr Start End Strand Length WT_1 WT_2 ...<br/>
                        geneA  1   100   500 +      400    120  145  ...
                    </div>
                  </div>
                  <div className="p-6 bg-green-50/50 rounded-3xl border border-green-100">
                    <h3 className="font-bold text-green-900 flex items-center gap-2 mb-3"><FileCode size={20}/> Annotation (.gff3)</h3>
                    <div className="text-[11px] font-mono bg-white p-3 rounded-xl border border-green-100 text-green-800 mb-4 overflow-x-auto whitespace-nowrap">
                        ... CDS ... locus_tag=geneA;product=MyProtein;Name=genA
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedGenes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300">
              <HelpCircle size={48} className="mb-4 opacity-10" />
              <p className="font-bold text-slate-400 uppercase tracking-widest text-sm text-center">Data Ready<br/><span className="text-[10px] font-normal lowercase tracking-normal">Click genes on the sidebar to plot</span></p>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-8 pb-12 animate-in fade-in duration-500">
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                <div className="mb-10 flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Expression Profile</h2>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Metric: <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">log₂ (TPM + 1)</span></p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
                    {selectedGenes.map((g, i) => {
                        const ann = annotations[g];
                        return (
                            <div key={g} className="relative text-xs p-4 rounded-3xl border border-slate-200 bg-slate-50/30 hover:border-indigo-200 transition-all hover:bg-white group shadow-xs">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-3 h-3 rounded-full shadow-sm" style={{backgroundColor: colors[i % colors.length]}} />
                                    <div className="overflow-hidden">
                                        <div className="flex items-center gap-2">
                                            <span className="font-black text-slate-800 text-sm tracking-tight truncate">{ann?.geneName || g}</span>
                                            {ann?.locus && ann?.locus !== g && <span className="text-[9px] font-mono text-slate-400 bg-slate-100 px-1 rounded flex-shrink-0">{ann.locus}</span>}
                                        </div>
                                        {ann?.system && (
                                            <div className="flex items-center gap-1 mt-1">
                                                <ShieldCheck size={10} className="text-emerald-500" />
                                                <span className="text-[10px] font-black text-emerald-600 uppercase tracking-tighter truncate">{ann.system}</span>
                                            </div>
                                        )}
                                    </div>
                                    <a href={`https://www.ncbi.nlm.nih.gov/gene/?term=${g}`} target="_blank" className="ml-auto text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"><ExternalLink size={14}/></a>
                                </div>
                                <p className="text-[10px] text-slate-500 leading-relaxed italic line-clamp-2">{ann?.product || 'No descriptive annotation available'}</p>
                            </div>
                        );
                    })}
                </div>
                <div className="h-[400px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart key={currentMode} data={fullStats} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="condition" axisLine={false} tickLine={false} tick={{fill:'#64748b', fontSize:11, fontWeight:600}} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill:'#64748b', fontSize:11}} width={35} />
                      <Tooltip content={<CustomTooltip annotations={annotations} />} isAnimationActive={false} />
                      {selectedGenes.flatMap((gene, i) => {
                        const c = colors[i % colors.length];
                        const keys = currentMode === 'both' ? [`${gene}_S`, `${gene}_A`] : [gene];
                        return keys.map((k, j) => (
                          <React.Fragment key={`${k}_${currentMode}_${j}`}>
                            <Area dataKey={`${k}_range`} stroke="none" fill={c} fillOpacity={j===0?0.15:0.05} connectNulls activeDot={false}/>
                            <Line dataKey={`${k}_mean`} name={currentMode === 'both' ? (j === 0 ? `${gene} (D1)` : `${gene} (D2)`) : gene} stroke={c} strokeWidth={j===0?3:2} strokeDasharray={j===1?"5 5":""} dot={{r:3, strokeWidth: 2, fill: j===0?c:'#fff'}} connectNulls />
                          </React.Fragment>
                        ));
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2"><Table size={18} className="text-slate-400"/><h3 className="font-bold text-slate-700 text-sm">Quantification Table</h3></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 border-b border-slate-100"><th className="px-4 py-3 font-bold border-r border-slate-100 min-w-[150px]">Gene / Cond</th>{fullStats.map(s => <th key={s.condition} className="px-4 py-3 font-bold text-center border-r border-slate-100 last:border-0">{s.condition}</th>)}</tr>
                    </thead>
                    <tbody>
                      {selectedGenes.map((gene, idx) => (
                        <React.Fragment key={gene}>
                          {(currentMode === 'sense' || currentMode === 'both') && (
                            <tr className="border-b border-slate-50 group hover:bg-blue-50/20 transition-colors">
                              <td className="px-4 py-2 border-r border-slate-100 bg-slate-50/20"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{backgroundColor: colors[idx % colors.length]}} /><span className="font-bold text-slate-800 truncate max-w-[100px]">{annotations[gene]?.geneName || gene}</span><span className="text-[9px] bg-blue-100 text-blue-700 px-1 rounded font-black">D1</span></div></td>
                              {fullStats.map(s => <td key={s.condition} className="px-4 py-2 text-center border-r border-slate-100 last:border-0"><span className="font-mono text-slate-700 font-bold">{s.genes[gene]?.sense?.tpmMean.toFixed(2) || '0.00'}</span><div className="text-[9px] text-slate-400">Reads: {Math.round(s.genes[gene]?.sense?.countMean || 0)}</div></td>)}
                            </tr>
                          )}
                          {(currentMode === 'antisense' || currentMode === 'both') && (
                            <tr className="border-b border-slate-100 last:border-0 hover:bg-purple-50/20 transition-colors">
                              <td className="px-4 py-2 border-r border-slate-100 bg-slate-50/20"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-slate-300" /><span className="font-bold text-slate-800 truncate max-w-[100px]">{annotations[gene]?.geneName || gene}</span><span className="text-[9px] bg-purple-100 text-purple-700 px-1 rounded font-black">D2</span></div></td>
                              {fullStats.map(s => <td key={s.condition} className="px-4 py-2 text-center border-r border-slate-100 last:border-0"><span className="font-mono text-slate-700 font-bold">{s.genes[gene]?.antisense?.tpmMean.toFixed(2) || '0.00'}</span><div className="text-[9px] text-slate-400">Reads: {Math.round(s.genes[gene]?.antisense?.countMean || 0)}</div></td>)}
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-500">
                    <p className="font-bold mb-1 uppercase tracking-wider text-slate-400 text-[9px]">Dataset Map</p>
                    <div className="flex gap-6">
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-400" /> <b>D1:</b> {fileData.sense?.sampleCols?.[0] || 'Manual Upload'}</span>
                        {fileData.antisense && <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-purple-400" /> <b>D2:</b> {fileData.antisense?.sampleCols?.[0] || 'Manual Upload'}</span>}
                    </div>
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