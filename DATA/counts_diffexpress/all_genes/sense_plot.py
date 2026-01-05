import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from plotly.offline import plot
import os

def calculate_log2_tpm(df):
    """
    Calculates log2(TPM + 1) from featureCounts dataframe.
    Assumes columns 0-5 are metadata and 6 onwards are counts.
    """
    # Extract gene lengths and counts
    gene_ids = df['Geneid']
    lengths = df['Length']
    counts = df.iloc[:, 6:]
    
    # 1. Calculate RPK (Reads Per Kilobase)
    # length / 1000 converts bp to kb
    rpk = counts.div(lengths / 1000, axis=0)
    
    # 2. Calculate TPM (Transcripts Per Million)
    # Divide RPK by (sum of RPKs / 1e6)
    scaling_factors = rpk.sum(axis=0) / 1e6
    tpm = rpk.div(scaling_factors, axis=1)
    
    # 3. Log2 transform with pseudocount of 1
    log2_tpm = np.log2(tpm + 1)
    
    # Re-attach Geneid
    log2_tpm.insert(0, 'Geneid', gene_ids)
    return log2_tpm

def generate_html_dashboard(input_file, output_html):
    print(f"Loading {input_file}...")
    
    # Load data, skipping the first metadata line starting with '#'
    df = pd.read_csv(input_file, sep='\t', comment='#')
    
    # Calculate log2TPM
    print("Calculating log2(TPM + 1)...")
    result_df = calculate_log2_tpm(df)
    
    # Prepare data for plotting (long format)
    plot_data = result_df.melt(id_vars=['Geneid'], var_name='Sample', value_name='log2TPM')
    
    # Extract Condition from sample name (e.g., d04 from d04_rep1_sorted.bam)
    plot_data['Condition'] = plot_data['Sample'].str.split('_').str[0]
    
    # Calculate mean and std per condition for each gene
    print("Aggregating data by condition...")
    stats = plot_data.groupby(['Geneid', 'Condition'])['log2TPM'].agg(['mean', 'std']).reset_index()
    
    # Sort by condition to ensure time-series progression (d04 -> d07 -> d11 -> d14 -> d21)
    # We'll extract the numeric part for logical sorting
    stats['Day'] = stats['Condition'].str.extract('(\d+)').astype(int)
    stats = stats.sort_values(['Geneid', 'Day'])

    print("Generating Interactive Ribbon Plots...")
    fig = go.Figure()

    unique_genes = stats['Geneid'].unique()
    num_to_show = 200 # Limiting to top 200 for file size
    
    for i, gene in enumerate(unique_genes[:num_to_show]):
        gene_stats = stats[stats['Geneid'] == gene]
        
        # Ribbon data (Mean + Std and Mean - Std)
        x = gene_stats['Condition']
        y_mean = gene_stats['mean']
        y_upper = y_mean + gene_stats['std'].fillna(0)
        y_lower = y_mean - gene_stats['std'].fillna(0)

        # 1. Add the ribbon (shaded area)
        fig.add_trace(
            go.Scatter(
                x=pd.concat([x, x[::-1]]), # x, then x reversed
                y=pd.concat([y_upper, y_lower[::-1]]), # upper, then lower reversed
                fill='toself',
                fillcolor='rgba(0,176,246,0.2)',
                line=dict(color='rgba(255,255,255,0)'),
                hoverinfo="skip",
                showlegend=False,
                name=f"{gene}_ribbon",
                visible=(i == 0)
            )
        )

        # 2. Add the mean line
        fig.add_trace(
            go.Scatter(
                x=x,
                y=y_mean,
                line=dict(color='rgb(0,176,246)', width=3),
                mode='lines+markers',
                name=gene,
                visible=(i == 0)
            )
        )

    # Create buttons for the dropdown menu
    # Each gene now has 2 traces (Ribbon + Line), so visibility list must handle pairs
    buttons = []
    num_traces_per_gene = 2
    total_traces = len(fig.data)
    
    for i, gene in enumerate(unique_genes[:num_to_show]):
        visibility = [False] * total_traces
        start_idx = i * num_traces_per_gene
        visibility[start_idx] = True # Ribbon
        visibility[start_idx + 1] = True # Line
        
        button = dict(
            label=gene,
            method="update",
            args=[{"visible": visibility},
                  {"title": f"Mean Expression Profile for {gene} (± SD)"}]
        )
        buttons.append(button)

    fig.update_layout(
        updatemenus=[{
            "buttons": buttons,
            "direction": "down",
            "showactive": True,
            "x": 0.1,
            "y": 1.2,
            "pad": {"t": 10}
        }],
        title=f"Mean Expression Profile for {unique_genes[0]} (± SD)",
        xaxis_title="Days (Condition)",
        yaxis_title="log2(TPM + 1)",
        template="plotly_white",
        hovermode="x unified"
    )

    # Save to HTML
    plot(fig, filename=output_html, auto_open=False)
    print(f"Done! Dashboard saved to {output_html}")

if __name__ == "__main__":
    input_filename = "sense_read_counts" 
    output_filename = "expression_dashboard.html"
    
    if os.path.exists(input_filename):
        generate_html_dashboard(input_filename, output_filename)
    else:
        print(f"Error: {input_filename} not found.")