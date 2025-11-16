import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface BookData {
  id: number;
  title: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<BookData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingBook, setAddingBook] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newBookData, setNewBookData] = useState({ title: "", copies: "", category: "", description: "" });
  const [selectedBook, setSelectedBook] = useState<BookData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [stats, setStats] = useState({ total: 0, verified: 0, categories: 0 });
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      
      try {
        console.log('Initializing FHEVM for library system...');
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadBooks();
      } catch (error) {
        console.error('Failed to load books:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  const loadBooks = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const booksList: BookData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const bookData = await contract.getBusinessData(businessId);
          booksList.push({
            id: parseInt(businessId.replace('book-', '')) || Date.now(),
            title: bookData.name,
            encryptedValue: businessId,
            publicValue1: Number(bookData.publicValue1) || 0,
            publicValue2: Number(bookData.publicValue2) || 0,
            description: bookData.description,
            timestamp: Number(bookData.timestamp),
            creator: bookData.creator,
            isVerified: bookData.isVerified,
            decryptedValue: Number(bookData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading book data:', e);
        }
      }
      
      setBooks(booksList);
      updateStats(booksList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load books" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (booksList: BookData[]) => {
    const total = booksList.length;
    const verified = booksList.filter(b => b.isVerified).length;
    const categories = new Set(booksList.map(b => b.publicValue2)).size;
    
    setStats({ total, verified, categories });
  };

  const addBook = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingBook(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Adding book with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const copiesValue = parseInt(newBookData.copies) || 1;
      const bookId = `book-${Date.now()}`;
      const contractAddress = await contract.getAddress();
      
      const encryptedResult = await encrypt(contractAddress, address, copiesValue);
      
      const tx = await contract.createBusinessData(
        bookId,
        newBookData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newBookData.category) || 1,
        0,
        newBookData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Book added successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadBooks();
      setShowAddModal(false);
      setNewBookData({ title: "", copies: "", category: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingBook(false); 
    }
  };

  const decryptBook = async (bookId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const bookData = await contractRead.getBusinessData(bookId);
      if (bookData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return Number(bookData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(bookId);
      const contractAddress = await contractRead.getAddress();
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(bookId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadBooks();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadBooks();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "System is available and running" 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredBooks = books.filter(book => {
    const matchesSearch = book.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         book.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = activeFilter === "all" || 
                         (activeFilter === "verified" && book.isVerified) ||
                         (activeFilter === "unverified" && !book.isVerified);
    return matchesSearch && matchesFilter;
  });

  const categoryNames: { [key: number]: string } = {
    1: "Technology",
    2: "Science",
    3: "Literature",
    4: "History",
    5: "Art"
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>LibSafe FHE 🔐</h1>
            <span>Privacy-First Decentralized Library</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="library-icon">📚</div>
            <h2>Welcome to LibSafe FHE</h2>
            <p>Connect your wallet to access the privacy-preserving decentralized library</p>
            <div className="feature-list">
              <div className="feature-item">
                <span className="feature-icon">🔒</span>
                <span>Encrypted borrowing records</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🌐</span>
                <span>Decentralized storage</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <span>FHE-powered privacy</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Library System...</p>
        <p className="loading-note">Setting up encrypted environment</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted library...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>LibSafe FHE</h1>
          <span>Decentralized Privacy Library</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            System Status
          </button>
          <button onClick={() => setShowAddModal(true)} className="add-book-btn">
            + Add Book
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="library-content">
        <div className="stats-panel">
          <div className="stat-card">
            <div className="stat-icon">📚</div>
            <div className="stat-info">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total Books</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🔐</div>
            <div className="stat-info">
              <div className="stat-value">{stats.verified}</div>
              <div className="stat-label">Encrypted</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📁</div>
            <div className="stat-info">
              <div className="stat-value">{stats.categories}</div>
              <div className="stat-label">Categories</div>
            </div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search books..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <span className="search-icon">🔍</span>
          </div>
          <div className="filter-tabs">
            <button 
              className={`filter-tab ${activeFilter === "all" ? "active" : ""}`}
              onClick={() => setActiveFilter("all")}
            >
              All Books
            </button>
            <button 
              className={`filter-tab ${activeFilter === "verified" ? "active" : ""}`}
              onClick={() => setActiveFilter("verified")}
            >
              Encrypted
            </button>
            <button 
              className={`filter-tab ${activeFilter === "unverified" ? "active" : ""}`}
              onClick={() => setActiveFilter("unverified")}
            >
              Public
            </button>
          </div>
        </div>

        <div className="books-grid">
          {filteredBooks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📖</div>
              <h3>No books found</h3>
              <p>Add the first book to start the encrypted library</p>
              <button onClick={() => setShowAddModal(true)} className="add-first-btn">
                Add First Book
              </button>
            </div>
          ) : (
            filteredBooks.map((book) => (
              <div 
                key={book.id} 
                className={`book-card ${book.isVerified ? "encrypted" : "public"}`}
                onClick={() => setSelectedBook(book)}
              >
                <div className="book-header">
                  <h3 className="book-title">{book.title}</h3>
                  <span className={`book-status ${book.isVerified ? "encrypted" : "public"}`}>
                    {book.isVerified ? "🔐" : "📖"}
                  </span>
                </div>
                <p className="book-description">{book.description}</p>
                <div className="book-meta">
                  <span className="book-category">
                    {categoryNames[book.publicValue1] || "General"}
                  </span>
                  <span className="book-date">
                    {new Date(book.timestamp * 1000).toLocaleDateString()}
                  </span>
                </div>
                <div className="book-footer">
                  <span className="book-creator">
                    {book.creator.substring(0, 6)}...{book.creator.substring(38)}
                  </span>
                  {book.isVerified && book.decryptedValue && (
                    <span className="book-copies">{book.decryptedValue} copies</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="faq-section">
          <button 
            onClick={() => setShowFAQ(!showFAQ)} 
            className="faq-toggle"
          >
            {showFAQ ? "Hide" : "Show"} FAQ
          </button>
          
          {showFAQ && (
            <div className="faq-content">
              <h3>FHE Library FAQ</h3>
              <div className="faq-item">
                <strong>How does FHE protect my privacy?</strong>
                <p>FHE allows computation on encrypted data without decryption, ensuring your reading habits remain private.</p>
              </div>
              <div className="faq-item">
                <strong>What data is encrypted?</strong>
                <p>Borrowing records and copy counts are fully encrypted using Zama FHE technology.</p>
              </div>
              <div className="faq-item">
                <strong>Is the library censorship-resistant?</strong>
                <p>Yes, the decentralized nature prevents any single entity from censoring content.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddBookModal 
          onSubmit={addBook} 
          onClose={() => setShowAddModal(false)} 
          adding={addingBook} 
          bookData={newBookData} 
          setBookData={setNewBookData}
          isEncrypting={isEncrypting}
          categoryNames={categoryNames}
        />
      )}

      {selectedBook && (
        <BookDetailModal 
          book={selectedBook} 
          onClose={() => setSelectedBook(null)} 
          onDecrypt={decryptBook}
          isDecrypting={fheIsDecrypting}
          categoryNames={categoryNames}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const AddBookModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  bookData: any;
  setBookData: (data: any) => void;
  isEncrypting: boolean;
  categoryNames: { [key: number]: string };
}> = ({ onSubmit, onClose, adding, bookData, setBookData, isEncrypting, categoryNames }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'copies') {
      const intValue = value.replace(/[^\d]/g, '');
      setBookData({ ...bookData, [name]: intValue });
    } else {
      setBookData({ ...bookData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="add-book-modal">
        <div className="modal-header">
          <h2>Add New Book</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <span className="encryption-icon">🔐</span>
            <span>Copy count will be encrypted with FHE technology</span>
          </div>
          
          <div className="form-group">
            <label>Book Title *</label>
            <input 
              type="text" 
              name="title" 
              value={bookData.title} 
              onChange={handleChange} 
              placeholder="Enter book title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Category *</label>
            <select name="category" value={bookData.category} onChange={handleChange}>
              <option value="">Select category</option>
              {Object.entries(categoryNames).map(([key, name]) => (
                <option key={key} value={key}>{name}</option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>Number of Copies (FHE Encrypted) *</label>
            <input 
              type="number" 
              name="copies" 
              value={bookData.copies} 
              onChange={handleChange} 
              placeholder="Enter number of copies..." 
              min="1"
            />
            <div className="field-note">This data will be fully encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={bookData.description} 
              onChange={handleChange} 
              placeholder="Enter book description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={adding || isEncrypting || !bookData.title || !bookData.copies || !bookData.category} 
            className="submit-btn"
          >
            {adding || isEncrypting ? "Encrypting and Adding..." : "Add Book"}
          </button>
        </div>
      </div>
    </div>
  );
};

const BookDetailModal: React.FC<{
  book: BookData;
  onClose: () => void;
  onDecrypt: (bookId: string) => Promise<number | null>;
  isDecrypting: boolean;
  categoryNames: { [key: number]: string };
}> = ({ book, onClose, onDecrypt, isDecrypting, categoryNames }) => {
  const handleDecrypt = async () => {
    await onDecrypt(book.encryptedValue);
  };

  return (
    <div className="modal-overlay">
      <div className="book-detail-modal">
        <div className="modal-header">
          <h2>Book Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="book-info-grid">
            <div className="info-item">
              <label>Title:</label>
              <span>{book.title}</span>
            </div>
            <div className="info-item">
              <label>Category:</label>
              <span>{categoryNames[book.publicValue1] || "General"}</span>
            </div>
            <div className="info-item">
              <label>Added:</label>
              <span>{new Date(book.timestamp * 1000).toLocaleDateString()}</span>
            </div>
            <div className="info-item">
              <label>Added by:</label>
              <span>{book.creator.substring(0, 6)}...{book.creator.substring(38)}</span>
            </div>
          </div>

          <div className="description-section">
            <label>Description:</label>
            <p>{book.description}</p>
          </div>

          <div className="encryption-section">
            <div className="encryption-status">
              <label>Encryption Status:</label>
              <span className={`status-badge ${book.isVerified ? "encrypted" : "public"}`}>
                {book.isVerified ? "🔐 Fully Encrypted" : "📖 Public Data"}
              </span>
            </div>
            
            <div className="copies-info">
              <label>Available Copies:</label>
              <div className="copies-value">
                {book.isVerified ? (
                  book.decryptedValue ? (
                    <span className="decrypted-value">{book.decryptedValue} (Decrypted)</span>
                  ) : (
                    <span className="encrypted-value">🔒 Encrypted</span>
                  )
                ) : (
                  <span className="public-value">{book.publicValue2 || "Unknown"}</span>
                )}
              </div>
            </div>

            {!book.isVerified && (
              <button 
                onClick={handleDecrypt} 
                disabled={isDecrypting}
                className="decrypt-btn"
              >
                {isDecrypting ? "🔓 Decrypting..." : "🔓 Decrypt Copies"}
              </button>
            )}

            {book.isVerified && (
              <div className="encryption-info">
                <div className="info-icon">ℹ️</div>
                <p>This book's copy count is fully encrypted using FHE technology</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

