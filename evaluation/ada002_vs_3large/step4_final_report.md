# Dual System Evaluation Results

**Analysis Date**: 2025-06-26 18:24:37  
**Data Generation**: Unknown  
**Total Queries Analyzed**: 19

## Executive Summary

**Winner**: 3-Large  
**Performance Improvement**: 44.5% (statistically significant)  
**Recommendation**: Deploy 3-Large to production

## System Performance Comparison

### 3-Large
- **Precision@1**: 0.421 (strict), 0.526 (lenient)
- **Precision@3**: 0.439 (strict), 0.544 (lenient)  
- **Precision@5**: 0.454 (strict), 0.593 (lenient)
- **NDCG@5**: 0.793
- **Average Relevance**: 1.67 / 4.0
- **Documents Evaluated**: 73 / 73

### Ada-002
- **Precision@1**: 0.316 (strict), 0.316 (lenient)
- **Precision@3**: 0.298 (strict), 0.421 (lenient)
- **Precision@5**: 0.252 (strict), 0.412 (lenient)
- **NDCG@5**: 0.627
- **Average Relevance**: 1.16 / 4.0
- **Documents Evaluated**: 90 / 90

## Statistical Analysis

| Metric | 3-Large | Ada-002 | Difference | % Change | p-value | Significant | Effect Size |
|--------|-------|-------|------------|----------|---------|-------------|-------------|
| Precision@1 (strict) | 0.421 | 0.316 | -0.105 | -25.0% | 0.494 | ✗ | -0.16 (negligible) |
| Precision@3 (strict) | 0.439 | 0.298 | -0.140 | -32.0% | 0.104 | ✗ | -0.39 (small) |
| Precision@5 (strict) | 0.454 | 0.252 | -0.202 | -44.5% | 0.020 | ✓ | -0.59 (medium) |
| Precision@1 (lenient) | 0.526 | 0.316 | -0.211 | -40.0% | 0.163 | ✗ | -0.33 (small) |
| Precision@3 (lenient) | 0.544 | 0.421 | -0.123 | -22.6% | 0.167 | ✗ | -0.33 (small) |
| Precision@5 (lenient) | 0.593 | 0.412 | -0.181 | -30.5% | 0.048 | ✓ | -0.49 (small) |
| NDCG@1 | 0.536 | 0.338 | -0.198 | -36.9% | 0.182 | ✗ | -0.32 (small) |
| NDCG@3 | 0.673 | 0.515 | -0.158 | -23.5% | 0.105 | ✗ | -0.39 (small) |
| NDCG@5 | 0.793 | 0.627 | -0.166 | -21.0% | 0.033 | ✓ | -0.53 (medium) |
| Average Relevance | 1.819 | 1.168 | -0.651 | -35.8% | 0.010 | ✓ | -0.66 (medium) |

## Query-Level Analysis

**Win Rate (Precision@5)**:
- 3-Large: 10 wins (52.6%)
- Ada-002: 4 wins (21.1%)
- Ties: 5 (26.3%)

### Queries with Largest Performance Differences

| Query ID | Query Text | 3-Large P@5 | Ada-002 P@5 | Difference | Winner |
|----------|------------|-------------|-------------|------------|--------|
| gF7tAV9b... | Who was Yogananda?... | 0.80 | 0.00 | -0.80 | 3-Large |
| LCHOMsPD... | Who said Matt is a vibration of energy and energy ... | 1.00 | 0.20 | -0.80 | 3-Large |
| gjZZP3DL... | Be Even-Minded and Cheerful... | 0.80 | 0.20 | -0.60 | 3-Large |
| Y5jBhOAv... | Find the story of Ram Gopal in Autobiography of a ... | 0.80 | 0.20 | -0.60 | 3-Large |
| fMCgfVG2... | what does it mean "to spiriitualize" something... | 0.50 | 0.00 | -0.50 | 3-Large |
| Adcj2i2j... | who liberated Judas Iscariot in the 20th century?... | 0.00 | 0.40 | +0.40 | Ada-002 |
| qGF8pzUg... | Provide a specifi example and quote for each one o... | 1.00 | 0.60 | -0.40 | 3-Large |
| JGNqNXdG... | tell me the episode where Master tells a disciple,... | 1.00 | 0.60 | -0.40 | 3-Large |
| CQiD9rSS... | Write a prompt for me that would help me learn to ... | 0.60 | 0.25 | -0.35 | 3-Large |
| FDNqJL6k... | What are some suggestions for people (esp. beginne... | 0.60 | 0.75 | +0.15 | Ada-002 |

## Methodology

**Evaluation Approach**: Manual human judgment with 4-point relevance scale  
**Relevance Scale**:
- 4 (Highly Relevant): Directly answers the query
- 3 (Relevant): Related and helpful  
- 2 (Somewhat Relevant): Tangentially related
- 1 (Not Relevant): Unrelated to the query

**Thresholds**:
- Strict: Relevance score ≥ 3 (highly relevant + relevant)
- Lenient: Relevance score ≥ 2 (includes somewhat relevant)

**Statistical Tests**: Paired t-test for significance testing  
**Effect Size**: Cohen's d for practical significance

## Limitations

- Sample size: 19 queries may limit statistical power
- Human evaluator bias and fatigue effects
- Skip rate: 0.0% (System 1), 0.0% (System 2)

## Recommendations

**🚀 Strong Recommendation**: Deploy the winning system to production. Performance improvement is both statistically significant and practically meaningful.

---
*Generated by Dual System Evaluation Pipeline Step 4*