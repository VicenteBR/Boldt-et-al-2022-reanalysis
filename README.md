**RNA-Seq Dynamic Browser: Boldt et al. 2022 Reanalysis**

An interactive web-based platform for the reanalysis of the _Sorangium_ sp. So ce836 transcriptomic landscape, based on Boldt et al. (2022) (https://enviromicro-journals.onlinelibrary.wiley.com/doi/10.1111/1751-7915.14246). 

**This project reanalyzes raw RNA-Seq data to:**
- Detect and quantify defense system activity during the growth curve
- Analyze transcriptome-wide potential antisense regulation in _Sorangium_ sp. So ce836
- Track expression shifts across experimental timepoints in log_2(TPM + 1) units.
**Access the live browser here: https://VicenteBR.github.io/Boldt-et-al-2022-reanalysis/**

**Dual Precomputed Loaders:**
- Reanalysis: Loads global sense/antisense counts and full annotation.
- Defense Systems: Focuses exclusively on the expression profiles of Padloc detected defense systems.

**Data Format Requirements**
To use the manual upload feature, ensure your files follow these schemas:

1. Count Files (.tsv)

The first 6 columns must follow the featureCounts standard:
| Geneid | Chr | Start | End | Strand | Length | Condition_Rep1 | Condition_Rep2 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| geneA | 1 | 100 | 500 | + | 400 | 120 | 145 |

2. Annotation Files (.gff3)

The parser extracts metadata from Column 9. For better reproducibility, include:

locus_tag= or ID= for gene mapping.

Name= for common gene symbols (e.g., GajA).

Note=system:NAME for defense system categorization.



_License_

This project is intended for research and educational purposes. Data sourced from Boldt et al. (2022). See the original publication for primary data usage rights.


**Contact:** vicente.gomes.filho@gmail.com
