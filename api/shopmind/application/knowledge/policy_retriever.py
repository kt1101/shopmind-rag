from shopmind.application.retrieval.dense import _single_vector
from shopmind.domain.search_result import RetrievedDocument
from shopmind.application.knowledge.base import KnowledgeMode, resolve_knowledge_mode, rrf_knowledge_hits
class PolicyDocumentRetriever:
    def __init__(self,repository,embedder,*,mode="hybrid",candidate_k=40,rrf_k=60): self.repository=repository; self.embedder=embedder; self.mode=KnowledgeMode(mode); self.candidate_k=candidate_k; self.rrf_k=rrf_k
    def retrieve(self,query,top_k,product_id=None):
        del product_id
        mode=resolve_knowledge_mode(self.mode,query)
        if mode in {KnowledgeMode.DENSE,KnowledgeMode.HYBRID} and hasattr(self.repository,"bind_embedding"): self.repository.bind_embedding(self.embedder)
        lex=self.repository.lexical_search(query,self.candidate_k) if mode in {KnowledgeMode.BM25,KnowledgeMode.HYBRID} else []
        dense=[]
        if mode in {KnowledgeMode.DENSE,KnowledgeMode.HYBRID}:
            vec=_single_vector(self.embedder.embed_texts([query]),self.embedder.dimension,kind="policy"); dense=self.repository.vector_search(vec,self.candidate_k,self.candidate_k)
        ranked=[(h,h.score) for h in (lex if mode==KnowledgeMode.BM25 else dense)]
        if mode==KnowledgeMode.HYBRID: ranked=rrf_knowledge_hits([lex,dense],k=self.rrf_k,top_k=self.candidate_k)
        return [RetrievedDocument(f"policy:{h.document_id}",str(h.metadata.get("content") or h.title),float(score),"policy",{**h.metadata,**(h.metadata.get("metadata") or {}),"title":h.title,"source_local_score":h.score}) for h,score in ranked[:top_k]]
