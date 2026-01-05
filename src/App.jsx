import React, { useState, useMemo, useRef } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area } from 'recharts';
import { Search, Trash2, Download, BarChart2, Info, FileText, Loader2, FileCode, ExternalLink, ArrowUpDown, Camera, Menu, X } from 'lucide-react';

const App = () => {
  const [fileData, setFileData] = useState({ sense: null, antisense: null });
  const [annotations, setAnnotations] = useState({}); // Map of GeneID -> { product, name, etc }
  const [currentMode, setCurrentMode] = useState('sense'); // 'sense', 'antisense', or 'both'
  const [selectedGenes, setSelectedGenes] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'asc' }); // 'id' | 'name' | 'expression'

  // Ref for chart export
  const chartRef = useRef(null);

  const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  const handleFileUpload = (event, mode) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (mode === 'annotation') {
        const parsedAnn = processGFF(text);
        setAnnotations(parsedAnn);
      } else {
        const processed = processData(text);
        if (processed) {
          setFileData(prev => ({ ...prev, [mode]: processed }));
          if (!fileData.sense && !fileData.antisense) {
            setCurrentMode(mode);
          }
        }
      }
      setIsProcessing(false);
    };
    reader.readAsText(file);
  };

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
          try {
            attrs[key.trim()] = decodeURIComponent(val.trim());
          } catch (e) {
            attrs[key.trim()] = val.trim();
          }
        }
      });

      const id = attrs['locus_tag'] || attrs['ID'];
      
      if (id) {
        const existing = map[id] || {};
        map[id] = {
          product: attrs['product'] || attrs['description'] || existing.product || "Hypothetical protein",
          geneName: attrs['Name'] || attrs['gene'] || existing.geneName || null,
          biotype: cols[2]
        };
      }
    });
    return map;
  };

  const processData = (text) => {
    try {
      const lines = text.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#'));
      if (lines.length < 2) throw new Error("File format invalid");

      const headers = lines[0].split('\t');
      const sampleCols = headers.slice(6);
      
      const rows = lines.slice(1).map(line => {
        const parts = line.split('\t');
        return {
          Geneid: parts[0],
          Chr: parts[1],
          Start: parts[2],
          End: parts[3],
          Strand: parts[4],
          Length: parseFloat(parts[5]),
          counts: parts.slice(6).map(val => {
            const num = parseFloat(val);
            return isNaN(num) ? 0 : num;
          })
        };
      });

      const rpkMatrix = rows.map(row => ({
        Geneid: row.Geneid,
        meta: { Chr: row.Chr, Start: row.Start, End: row.End, Strand: row.Strand },
        rpk: row.counts.map(c => c / (row.Length / 1000 || 1))
      }));

      const sampleTotals = sampleCols.map((_, i) => 
        rpkMatrix.reduce((sum, row) => sum + row.rpk[i], 0) / 1000000
      );

      const log2tpm = rpkMatrix.map(row => {
        const tpmValues = row.rpk.map((val, i) => {
          const factor = sampleTotals[i] || 1;
          return Math.log2((val / factor) + 1);
        });
        const entry = { Geneid: row.Geneid, ...row.meta };
        sampleCols.forEach((s, i) => {
          entry[s] = tpmValues[i];
        });
        return entry;
      });

      const conditions = Array.from(new Set(sampleCols.map(s => s.split('_')[0])));
      conditions.sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || 0);
        const numB = parseInt(b.match(/\d+/)?.[0] || 0);
        return numA - numB;
      });

      return {
        raw: log2tpm,
        conditions,
        sampleCols,
        geneList: log2tpm.map(r => r.Geneid)
      };
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  const listSource = useMemo(() => fileData.sense || fileData.antisense, [fileData]);

  const aggregatedData = useMemo(() => {
    if (selectedGenes.length === 0) return [];
    const conditions = fileData.sense?.conditions || fileData.antisense?.conditions || [];
    
    return conditions.map(cond => {
      const point = { condition: cond };
      
      selectedGenes.forEach(geneId => {
        if (currentMode === 'sense' || currentMode === 'both') {
          const geneRow = fileData.sense?.raw.find(r => r.Geneid === geneId);
          if (geneRow) {
            const relevantSamples = fileData.sense.sampleCols.filter(s => s.startsWith(cond));
            const values = relevantSamples.map(s => geneRow[s]);
            const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
            const variance = values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / (values.length || 1);
            const std = Math.sqrt(variance);
            const keyPrefix = currentMode === 'both' ? `${geneId}_S` : geneId;
            point[`${keyPrefix}_mean`] = mean;
            point[`${keyPrefix}_range`] = [Math.max(0, mean - std), mean + std];
          }
        }

        if (currentMode === 'antisense' || currentMode === 'both') {
          const geneRow = fileData.antisense?.raw.find(r => r.Geneid === geneId);
          if (geneRow) {
            const relevantSamples = fileData.antisense.sampleCols.filter(s => s.startsWith(cond));
            const values = relevantSamples.map(s => geneRow[s]);
            const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
            const variance = values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / (values.length || 1);
            const std = Math.sqrt(variance);
            const keyPrefix = currentMode === 'both' ? `${geneId}_A` : geneId;
            point[`${keyPrefix}_mean`] = mean;
            point[`${keyPrefix}_range`] = [Math.max(0, mean - std), mean + std];
          }
        }
      });
      return point;
    });
  }, [fileData, selectedGenes, currentMode]);

  const toggleGene = (gene) => {
    if (selectedGenes.includes(gene)) {
      setSelectedGenes(selectedGenes.filter(g => g !== gene));
    } else {
      if (selectedGenes.length < 7) setSelectedGenes([...selectedGenes, gene]);
    }
  };

  // Improved filtering + Sorting
  const filteredGenes = useMemo(() => {
    if (!listSource) return [];
    const term = searchTerm.toLowerCase();
    
    // 1. Filter
    let genes = listSource.geneList.filter(g => {
      const idMatch = g.toLowerCase().includes(term);
      const ann = annotations[g];
      const productMatch = ann?.product?.toLowerCase().includes(term);
      const nameMatch = ann?.geneName?.toLowerCase().includes(term);
      return idMatch || productMatch || nameMatch;
    });

    // 2. Pre-calculate Expression Map if sorting by expression
    let expressionMap = null;
    if (sortConfig.key === 'expression' && fileData.sense) {
      expressionMap = new Map();
      fileData.sense.raw.forEach(row => {
        let sum = 0;
        fileData.sense.sampleCols.forEach(col => {
          sum += row[col];
        });
        const mean = sum / (fileData.sense.sampleCols.length || 1);
        expressionMap.set(row.Geneid, mean);
      });
    }

    // 3. Sort
    genes.sort((a, b) => {
      // Expression Sort (Numeric)
      if (sortConfig.key === 'expression') {
        const valA = expressionMap?.get(a) || -1;
        const valB = expressionMap?.get(b) || -1;
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
      }

      // ID/Name Sort (String)
      let valA, valB;
      if (sortConfig.key === 'id') {
        valA = a;
        valB = b;
      } else {
        // Sort by product name, fallback to ID if no product
        valA = annotations[a]?.product || annotations[a]?.geneName || a;
        valB = annotations[b]?.product || annotations[b]?.geneName || b;
      }

      // Simple string comparison
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return genes.slice(0, 100);
  }, [listSource, searchTerm, annotations, sortConfig, fileData.sense]);

  const handleSortToggle = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleDownloadPlot = () => {
    const svgElement = document.querySelector('.recharts-wrapper svg');
    if (!svgElement) return;

    // Serialize SVG
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // Create download link
    const link = document.createElement('a');
    link.href = url;
    link.download = `rna_seq_plot_${new Date().toISOString().slice(0,10)}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const allReset = () => {
    setFileData({ sense: null, antisense: null });
    setAnnotations({});
    setSelectedGenes([]);
    setCurrentMode('sense');
  };

  const GeneInfoCard = ({ geneId, color, idx }) => {
    const ann = annotations[geneId];
    const row = fileData.sense?.raw.find(r => r.Geneid === geneId) || fileData.antisense?.raw.find(r => r.Geneid === geneId);
    
    return (
      <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col gap-2 relative overflow-hidden transition-all hover:shadow-md">
        <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: color }}></div>
        <div className="flex justify-between items-start pl-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 text-sm">{geneId}</span>
              {ann?.geneName && <span className="bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5 rounded font-mono">{ann.geneName}</span>}
            </div>
            {ann?.product && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2" title={ann.product}>{ann.product}</p>}
          </div>
          <a href={`https://www.ncbi.nlm.nih.gov/gene/?term=${geneId}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 p-1 opacity-50 hover:opacity-100 transition-opacity">
            <ExternalLink size={14} />
          </a>
        </div>
        {row && (
           <div className="flex gap-3 pl-2 text-[10px] text-slate-400 font-mono">
             <span>{row.Chr}:{row.Start}-{row.End}</span>
             <span>({row.Strand})</span>
           </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-lg shadow-blue-200 shadow-md">
            <BarChart2 className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">RNA-Seq Browser</h1>
            {listSource && (
              <div className="flex items-center gap-2">
                 <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${currentMode === 'both' ? 'bg-indigo-100 text-indigo-700' : currentMode === 'sense' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                  {currentMode} view
                </span>
                <span className="text-[10px] text-slate-400">v1.0</span>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {(!fileData.sense || !fileData.antisense) && !isProcessing && (
            <div className="flex gap-2">
              {!fileData.sense && <label className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg cursor-pointer transition-all shadow-sm hover:shadow text-sm font-medium"><FileText size={16} />Load Sense<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'sense')} /></label>}
              {!fileData.antisense && <label className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg cursor-pointer transition-all shadow-sm text-sm font-medium"><FileText size={16} />Load Antisense<input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'antisense')} /></label>}
            </div>
          )}
          
          {(fileData.sense || fileData.antisense) && (
            <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors text-xs font-bold border ${Object.keys(annotations).length > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
              <FileCode size={14} />
              {Object.keys(annotations).length > 0 ? 'GFF Loaded' : 'Load GFF3'}
              <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, 'annotation')} />
            </label>
          )}

          {isProcessing && <div className="flex items-center gap-2 text-blue-600 font-medium text-sm bg-blue-50 px-3 py-1 rounded-full"><Loader2 className="animate-spin" size={16} />Processing...</div>}
          
          {(fileData.sense || fileData.antisense) && (
            <>
              <div className="h-8 w-px bg-slate-200 mx-2"></div>
              <div className="flex items-center bg-slate-100 p-1 rounded-lg">
                <button onClick={() => setCurrentMode('sense')} disabled={!fileData.sense} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${currentMode === 'sense' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500 hover:text-slate-700 disabled:opacity-30'}`}>Sense</button>
                <button onClick={() => setCurrentMode('antisense')} disabled={!fileData.antisense} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${currentMode === 'antisense' ? 'bg-white shadow-sm text-purple-700' : 'text-slate-500 hover:text-slate-700 disabled:opacity-30'}`}>Antisense</button>
                <button onClick={() => setCurrentMode('both')} disabled={!fileData.sense || !fileData.antisense} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${currentMode === 'both' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-500 hover:text-slate-700 disabled:opacity-30'}`}>Both</button>
              </div>
              <button onClick={allReset} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Reset All Data"><Trash2 size={18} /></button>
            </>
          )}
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)] z-0">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={16} />
              <input 
                type="text" 
                placeholder="Search ID, Name, Product..." 
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm outline-none transition-all" 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
                disabled={!listSource} 
              />
            </div>
            
            {/* Sort Controls */}
            {listSource && (
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Sort by:</span>
                <div className="flex gap-1">
                  <button 
                    onClick={() => handleSortToggle('id')}
                    className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${sortConfig.key === 'id' ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-100'}`}
                  >
                    ID {sortConfig.key === 'id' && <ArrowUpDown size={10} />}
                  </button>
                  <button 
                    onClick={() => handleSortToggle('name')}
                    className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${sortConfig.key === 'name' ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-100'}`}
                  >
                    Name/Desc {sortConfig.key === 'name' && <ArrowUpDown size={10} />}
                  </button>
                  <button 
                    onClick={() => handleSortToggle('expression')}
                    className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${sortConfig.key === 'expression' ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-100'} disabled:opacity-50 disabled:cursor-not-allowed`}
                    disabled={!fileData.sense}
                    title="Sort by mean Sense expression (log2TPM)"
                  >
                    Expr {sortConfig.key === 'expression' && <ArrowUpDown size={10} />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-200">
            {!listSource ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                  <Info size={32} className="opacity-40" />
                </div>
                <p className="text-sm font-medium text-slate-500">No data loaded</p>
                <p className="text-xs mt-1">Upload a counts file to view genes.</p>
              </div>
            ) : (
              <div className="space-y-1">
                 {filteredGenes.length === 0 && (
                   <div className="p-4 text-center text-xs text-slate-400 italic">No genes match your search.</div>
                 )}
                {filteredGenes.map(gene => {
                   const ann = annotations[gene];
                   const isSelected = selectedGenes.includes(gene);
                   return (
                    <button 
                      key={gene} 
                      onClick={() => toggleGene(gene)} 
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center justify-between group transition-all duration-200 border border-transparent ${isSelected ? 'bg-blue-50 border-blue-100 shadow-sm' : 'hover:bg-slate-50 hover:border-slate-100'}`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center justify-between">
                          <span className={`font-mono text-xs ${isSelected ? 'text-blue-700 font-bold' : 'text-slate-700 font-medium'}`}>{gene}</span>
                          {ann?.geneName && <span className="text-[10px] bg-slate-100 px-1.5 rounded text-slate-500">{ann.geneName}</span>}
                        </div>
                        {ann?.product && <span className="text-[11px] text-slate-400 truncate block mt-0.5 group-hover:text-slate-500 transition-colors">{ann.product}</span>}
                      </div>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 shadow-sm shadow-blue-300" />}
                    </button>
                   );
                })}
              </div>
            )}
          </div>

          {selectedGenes.length > 0 && (
            <div className="p-4 border-t border-slate-200 bg-slate-50/50 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active ({selectedGenes.length}/7)</span>
                <button 
                  onClick={() => setSelectedGenes([])}
                  className="text-[10px] text-red-500 hover:text-red-700 font-medium flex items-center gap-1 transition-colors hover:bg-red-50 px-2 py-1 rounded"
                >
                  <Trash2 size={12} /> Clear All
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedGenes.map((gene, idx) => (
                  <div key={gene} className="bg-white border border-slate-200 px-2 py-1 rounded-md text-[10px] flex items-center gap-2 shadow-sm animate-in fade-in zoom-in duration-200">
                    <div className="w-2 h-2 rounded-full" style={{backgroundColor: colors[idx % colors.length]}} />
                    <span className="max-w-[100px] truncate font-medium text-slate-700">{gene}</span>
                    <button onClick={() => toggleGene(gene)} className="text-slate-400 hover:text-red-500 ml-1 rounded-full hover:bg-red-50 p-0.5 transition-colors"><X size={10} strokeWidth={3} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main Chart Area */}
        <div className="flex-1 p-8 overflow-y-auto bg-slate-50/50 scrollbar-thin">
          {selectedGenes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white p-6 rounded-full shadow-sm mb-6">
                <BarChart2 size={64} className="text-slate-200" />
              </div>
              <h2 className="text-xl font-bold text-slate-700 mb-2">Ready to Visualize</h2>
              <p className="text-slate-500 max-w-sm text-center">Select genes from the sidebar to generate expression profiles. Toggle between Sense and Antisense modes to see different strand data.</p>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 relative">
                
                {/* Chart Header */}
                <div className="flex justify-between items-start mb-8">
                   <div>
                      <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                        Expression Profile
                        <span className="text-sm font-normal text-slate-400 bg-slate-100 px-2 py-1 rounded-full">log2(TPM+1)</span>
                      </h2>
                      {Object.keys(annotations).length === 0 && (
                        <p className="text-xs text-orange-500 font-medium flex items-center gap-1 mt-2 bg-orange-50 w-fit px-2 py-1 rounded">
                          <Info size={12}/> Load GFF3 file for gene descriptions
                        </p>
                      )}
                   </div>
                   
                   <button 
                     onClick={handleDownloadPlot}
                     className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-sm font-medium transition-all active:scale-95"
                     title="Export Plot as SVG"
                   >
                     <Camera size={16} />
                     Export Plot
                   </button>
                </div>
                
                {/* Gene Info Cards */}
                <div className="mb-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {selectedGenes.map((geneId, idx) => (
                       <GeneInfoCard key={geneId} geneId={geneId} idx={idx} color={colors[idx % colors.length]} />
                    ))}
                  </div>
                  
                  {/* Legend Indicators */}
                  <div className="flex flex-wrap gap-6 mt-6 pt-4 border-t border-slate-100">
                     { (currentMode === 'sense' || currentMode === 'both') && (
                       <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded">
                         <div className="w-8 h-1 bg-slate-400 rounded-full"></div>
                         <span>Sense (Mean ± SD)</span>
                       </div>
                     )}
                     { (currentMode === 'antisense' || currentMode === 'both') && (
                       <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded">
                         <div className="flex items-center w-8 overflow-hidden">
                           <div className="w-2 h-2 rounded-full bg-slate-400"></div>
                           <div className="w-full border-t-2 border-dashed border-slate-400 ml-1"></div>
                         </div>
                         <span>Antisense (Mean ± SD)</span>
                       </div>
                     )}
                  </div>
                </div>

                {/* The Chart */}
                <div className="h-[500px] w-full" ref={chartRef}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={aggregatedData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="condition" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fill: '#64748b', fontSize: 12, fontWeight: 500}} 
                        dy={15} 
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fill: '#64748b', fontSize: 12}} 
                        label={{ value: 'log2(TPM + 1)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12, fontWeight: 700 }} 
                      />
                      <Tooltip 
                        cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                        contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px'}}
                        formatter={(value, name) => {
                          if (Array.isArray(value) && value.length === 2) {
                              return [`${value[0]?.toFixed(2)} - ${value[1]?.toFixed(2)}`, name];
                          }
                          if (typeof value === 'number') {
                              return [value.toFixed(2), name];
                          }
                          return [value, name];
                        }}
                      />
                      
                      {selectedGenes.flatMap((geneId, idx) => {
                        const baseColor = colors[idx % colors.length];
                        const series = [];

                        if (currentMode === 'sense' || currentMode === 'both') {
                          const name = currentMode === 'both' ? `${geneId} (S)` : geneId;
                          series.push(
                            <Area 
                              key={`${geneId}_S_ribbon`}
                              dataKey={currentMode === 'both' ? `${geneId}_S_range` : `${geneId}_range`}
                              stroke="none"
                              fill={baseColor}
                              fillOpacity={0.15}
                              connectNulls
                            />
                          );
                          series.push(
                            <Line 
                              key={`${geneId}_S_line`}
                              dataKey={currentMode === 'both' ? `${geneId}_S_mean` : `${geneId}_mean`}
                              name={name}
                              stroke={baseColor}
                              strokeWidth={3}
                              dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: baseColor }}
                              activeDot={{ r: 6, strokeWidth: 0, fill: baseColor }}
                              connectNulls
                            />
                          );
                        }

                        if (currentMode === 'antisense' || currentMode === 'both') {
                          const name = currentMode === 'both' ? `${geneId} (A)` : geneId;
                          series.push(
                            <Area 
                              key={`${geneId}_A_ribbon`}
                              dataKey={currentMode === 'both' ? `${geneId}_A_range` : `${geneId}_range`}
                              stroke="none"
                              fill={baseColor}
                              fillOpacity={0.08}
                              connectNulls
                            />
                          );
                          series.push(
                            <Line 
                              key={`${geneId}_A_line`}
                              dataKey={currentMode === 'both' ? `${geneId}_A_mean` : `${geneId}_mean`}
                              name={name}
                              stroke={baseColor}
                              strokeWidth={2}
                              strokeDasharray="6 4"
                              dot={{ r: 3, strokeWidth: 0, fill: baseColor }}
                              activeDot={{ r: 6, strokeWidth: 0 }}
                              connectNulls
                            />
                          );
                        }
                        return series;
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