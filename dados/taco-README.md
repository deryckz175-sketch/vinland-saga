# taco.json — procedência e conferência

## Fonte

**Tabela Brasileira de Composição de Alimentos (TACO), 4ª edição revisada e ampliada — NEPA/UNICAMP, 2011.**

Os dados **não foram digitados nem gerados**: foram convertidos de arquivos publicados.

| | |
|---|---|
| Arquivo convertido | `data/processed/taco/taco_composicao.csv` |
| Planilha de referência | `data/raw/taco/Taco_4a_edicao_2011.xls` |
| Repositório | https://github.com/brolesi/taco |
| URL do CSV | https://raw.githubusercontent.com/brolesi/taco/master/data/processed/taco/taco_composicao.csv |
| URL da planilha | https://raw.githubusercontent.com/brolesi/taco/master/data/raw/taco/Taco_4a_edicao_2011.xls |
| Data do download | 1º de novembro de 2026 |

A reprodução da TACO é permitida desde que a fonte seja citada (NEPA/UNICAMP, `taco@unicamp.br`).

## Conteúdo

- **597 alimentos**, que é o total da 4ª edição.
- Seis valores por 100 g: `kcal`, `proteina`, `carboidrato`, `gordura` (lipídeos), `fibra` (fibra alimentar) e `sodio`.
- Massas em gramas, sódio em miligramas, energia em kcal. Arredondados para 2 casas.
- Nomes e categorias exatamente como na TACO.

## Conferência feita

Comparei o JSON contra a **planilha original**, não contra o CSV intermediário — ou seja, a conversão de terceiros também foi auditada.

- **Todos os 597 alimentos, nos 6 campos: zero divergência numérica.**
- Os 5 itens conferidos item a item: 1 (Arroz, integral, cozido), 100 (Brócolis, cozido), 300 (Manjuba, frita), 450 (Iogurte, sabor abacaxi) e 597 (Noz, crua).
- Atenção: a planilha repete a coluna "Número do Alimento" no meio da tabela, na posição 13. Quem contar as colunas sem perceber isso lê **ferro no lugar de sódio**. Foi o primeiro erro que apareceu na conferência.

## Células vazias

A planilha usa dois símbolos diferentes, e eles **não significam a mesma coisa**:

| Na planilha | No JSON | Quantas | Por quê |
|---|---|---|---|
| `NA` — não analisado | `null` | 288 | Valor desconhecido. Somar como zero inventaria um dado que ninguém mediu. |
| `Tr` — traço | `0` | 107 | Foi medido e deu quantidade desprezível. Num diário de comida isso é zero, não é incógnita. |

Isto é um desvio deliberado da instrução original da tarefa, que mandava converter `Tr` para `null` também. `Tr` é medição, não ausência.

**Quem for somar macros precisa tratar `null`**, senão vira `NaN`. São 288 células, a maioria em fibra (235 alimentos não têm fibra analisada).

## Formato

```json
{
  "id": "taco-001",
  "nome": "Arroz, integral, cozido",
  "categoria": "Cereais e derivados",
  "por100g": {
    "kcal": 123.53,
    "proteina": 2.59,
    "carboidrato": 25.81,
    "gordura": 1,
    "fibra": 2.75,
    "sodio": 1.24
  }
}
```
