// Scripts for chat functionality 
    // Global state
    let isAutoScrollEnabled = true;
    let chatHistory = [];
    const MAX_HISTORY_PAIRS = 10; // Max Q&A pairs kept in memory (10 pairs = 20 messages)
    const tokenLimits = {
      systemPrompt: Math.floor(128000 * 0.02),
      userQuestion: Math.floor(128000 * 0.24),
      aiResponse: Math.floor(128000 * 0.50),
      chatHistory: Math.floor(128000 * 0.24)
    };

    // Function to display login modal if not logged in
    function displayLoginModal() {
      window.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => {
          const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
          loginModal.show();
        }, 1200);
      });
    }

    function goLogin() {
      window.location.href = '/login/0';
    }
    

    // Theme initialization
    function initializeTheme() {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const savedTheme = localStorage.getItem('theme');
      const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', initialTheme);

      // Theme toggle handler with code highlighting refresh
      const themeToggle = document.getElementById('themeToggle');
      if (themeToggle) {
        themeToggle.addEventListener('click', () => {
          const currentTheme = document.documentElement.getAttribute('data-theme');
          const newTheme = currentTheme === 'light' ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', newTheme);
          localStorage.setItem('theme', newTheme);
          
          // Refresh code highlighting
          if (typeof Prism !== 'undefined') {
            requestAnimationFrame(() => {
              Prism.highlightAll();
            });
          }
        });
      }

      // Listen for system theme changes
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
          const newTheme = e.matches ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', newTheme);
          
          // Refresh code highlighting
          if (typeof Prism !== 'undefined') {
            requestAnimationFrame(() => {
              Prism.highlightAll();
            });
          }
        }
      });
    }

    // Initialize sidebar functionality
    function initializeSidebar() {
      const sidebarToggle = document.getElementById('sidebarToggle');
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      const mainContent = document.querySelector('.main-content');
      
      if (!sidebarToggle || !sidebar || !mainContent) return;

      const isMobile = () => window.innerWidth <= 768;

      // Helper: collapse sidebar + hide overlay
      function collapseSidebar() {
        sidebar.classList.add('collapsed');
        mainContent.classList.add('full-width');
        if (overlay) overlay.classList.remove('active');
        if (!isMobile()) {
          localStorage.setItem('sidebarCollapsed', 'true');
        }
      }

      // Helper: expand sidebar + show overlay on mobile
      function expandSidebar() {
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('full-width');
        if (isMobile() && overlay) overlay.classList.add('active');
        if (!isMobile()) {
          localStorage.setItem('sidebarCollapsed', 'false');
        }
      }

      // Set initial state
      if (isMobile()) {
        // Mobile: always start collapsed
        collapseSidebar();
      } else {
        // Desktop: restore saved state
        const savedCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        if (savedCollapsed) {
          collapseSidebar();
        }
      }

      // Toggle handler
      sidebarToggle.addEventListener('click', () => {
        const isCollapsed = sidebar.classList.contains('collapsed');
        if (isCollapsed) {
          expandSidebar();
        } else {
          collapseSidebar();
        }
      });

      // Overlay tap-to-dismiss (mobile)
      if (overlay) {
        overlay.addEventListener('click', () => {
          collapseSidebar();
        });
      }

      // Auto-close sidebar when clicking a chat link on mobile
      const pdfLinks = document.querySelectorAll('#pdfList .list-group-item a');
      pdfLinks.forEach(link => {
        link.addEventListener('click', () => {
          if (isMobile()) {
            collapseSidebar();
          }
        });
      });

      // Handle resize: mobile ↔ desktop transitions
      let wasMobile = isMobile();
      window.addEventListener('resize', () => {
        const nowMobile = isMobile();
        if (wasMobile !== nowMobile) {
          if (nowMobile) {
            // Switched to mobile → collapse and hide overlay
            collapseSidebar();
          } else {
            // Switched to desktop → restore saved state, remove overlay
            if (overlay) overlay.classList.remove('active');
            const savedCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
            if (savedCollapsed) {
              collapseSidebar();
            } else {
              expandSidebar();
            }
          }
          wasMobile = nowMobile;
        }
      });
    }

    // Initialize rename functionality
    function initializeRenameForm() {
      const modal = document.getElementById('renameModal');
      const pdfIndexInput = document.getElementById('pdfIndex');
      const newTitleInput = document.getElementById('newTitle');
      const cancelBtn = document.getElementById('cancelRename');
      const renameBtns = document.querySelectorAll('.renameBtn');

      renameBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const sessionId = btn.dataset.id;
          const title = btn.dataset.title;
          pdfIndexInput.value = sessionId;
          newTitleInput.value = title;
          modal.classList.remove('d-none');
        });
      });

      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          modal.classList.add('d-none');
        });
      }

      const renameForm = document.getElementById('renameForm');
      if (renameForm) {
        renameForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const sessionId = pdfIndexInput.value;
          const newTitle = newTitleInput.value;

          try {
            const res = await fetch(`/api/v1/rename/${sessionId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ newTitle })
            });

            if (res.ok) {
              window.location.reload();
            } else {
              throw new Error('Failed to rename PDF');
            }
          } catch (err) {
            console.error('Error renaming:', err);
            alert('Failed to rename PDF: ' + err.message);
          }

          modal.classList.add('d-none');
        });
      }
    }

    // Initialize scroll management
    function initializeScrollManagement() {
      const messagesContainer = document.querySelector('.chat-messages-container');
      if (!messagesContainer) return;

      // Store last scroll position
      let lastScrollHeight = messagesContainer.scrollHeight;
      
      // Initial scroll to bottom
      const initialScroll = () => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        isAutoScrollEnabled = true;
      };

      // Try multiple times to ensure content is loaded
      setTimeout(initialScroll, 0);
      setTimeout(initialScroll, 100);
      setTimeout(initialScroll, 500);

      // Watch for content changes
      const resizeObserver = new ResizeObserver(() => {
        const newScrollHeight = messagesContainer.scrollHeight;
        if (newScrollHeight !== lastScrollHeight) {
          if (isAutoScrollEnabled) {
            messagesContainer.scrollTop = newScrollHeight;
          }
          lastScrollHeight = newScrollHeight;
        }
      });

      resizeObserver.observe(messagesContainer);
    }

    // Scroll handling
    function scrollToBottom() {
      requestAnimationFrame(() => {
        const messagesContainer = document.querySelector('.chat-messages-container');
        if (!messagesContainer || !isAutoScrollEnabled) return;
        
        messagesContainer.scrollTo({
          top: messagesContainer.scrollHeight,
          behavior: 'smooth'
        });
      });
    }

    // Initialize all components
    document.addEventListener("DOMContentLoaded", function() {
      // Initialize theme first
      initializeTheme();

      // Check if user is logged in by looking for logout link
      const isUserLoggedIn = document.querySelector('.action-buttons a.logout') !== null;
      
      // Only initialize sidebar and rename form if user is logged in
      if (isUserLoggedIn) {
        // Show sidebar and toggle button for logged in users
        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebarToggle');
        if (sidebar) sidebar.style.display = 'flex';
        if (sidebarToggle) sidebarToggle.style.display = 'flex';
        
        initializeSidebar();
        initializeRenameForm();
      }

      // Show login modal only for non-logged in users
      if (!isUserLoggedIn) {
        displayLoginModal();
        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.classList.add('full-width');
      }

      // Initialize scroll management
      initializeScrollManagement();

      const messagesContainer = document.querySelector('.chat-messages-container');
      if (messagesContainer) {
        // Initial scroll
        setTimeout(scrollToBottom, 100);

        // Manual scroll detection
        messagesContainer.addEventListener('scroll', function() {
          const isAtBottom = Math.abs(
            messagesContainer.scrollHeight - 
            messagesContainer.clientHeight - 
            messagesContainer.scrollTop
          ) < 20;
          isAutoScrollEnabled = isAtBottom;
        });

        // Observe chat changes
        const observer = new MutationObserver(() => {
          if (isAutoScrollEnabled) {
            scrollToBottom();
          }
        });

        observer.observe(messagesContainer, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }

      // Initialize chat form
      const chatForm = document.getElementById("chatForm");
      if (chatForm) {
        const urlPath = window.location.pathname;
        const hasSession = urlPath.startsWith('/chat/') && urlPath.length > 6; // longer than just "/chat/"
        const questionInput = chatForm.querySelector('#question');
        const submitBtn = chatForm.querySelector('button');
        
        // Enable/disable chat input based on session presence, not login status
        if (!hasSession) {
          if (questionInput) questionInput.disabled = true;
          if (submitBtn) submitBtn.disabled = true;
          questionInput.placeholder = "Please upload a PDF first...";
        } else {
          if (questionInput) questionInput.disabled = false;
          if (submitBtn) submitBtn.disabled = false;
          questionInput.placeholder = "Ask a question...";
        }
        
        chatForm.addEventListener("submit", handleChatSubmit);
      }

      // Handle window resize
      window.addEventListener('resize', () => {
        if (isAutoScrollEnabled) {
          scrollToBottom();
        }
      });
    });

    // Update formatting for code blocks
    function updateFormatting() {
      if (typeof Prism !== 'undefined') {
        Prism.highlightAll();
      }
    }

    async function handleChatSubmit(e) {
      e.preventDefault();
      const chatBox = document.getElementById("chatBox");
      const messagesContainer = chatBox?.querySelector('.chat-messages-container');
      const questionInput = document.getElementById("question");
      const question = questionInput.value.trim();
      
      // Get sessionId from the current URL
      const urlPath = window.location.pathname;
      const hasSession = urlPath.startsWith('/chat/') && urlPath.length > 6;
      const sessionId = hasSession ? urlPath.split('/')[2] : null;
      
      if (!question || !messagesContainer || !sessionId) return;

      try {
        isAutoScrollEnabled = true;

        // Add user message
        const userMessage = document.createElement('div');
        userMessage.className = 'user-message';
        userMessage.innerHTML = `${question}`;
        messagesContainer.appendChild(userMessage);
        scrollToBottom();

        // Show typing indicator
        const template = document.getElementById('typingIndicatorTemplate');
        const typingIndicator = template.content.cloneNode(true);
        messagesContainer.appendChild(typingIndicator);
        scrollToBottom();

        // Clear and focus input
        questionInput.value = "";
        questionInput.focus();

        // Send request
        const res = await fetch(`/api/v1/ask/${sessionId}`, {
          method: "POST",
          credentials: 'include',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            question,
            chatHistory,
            tokenLimits
          })
        });

        // Remove typing indicator
        const typingElement = messagesContainer.querySelector('.typing-indicator');
        if (typingElement) {
          typingElement.remove();
        }

        if (!res.ok) throw new Error(`Server responded with status: ${res.status}`);

        const data = await res.json();
        if (!data.answer) throw new Error('No response received from server');

        // Add AI response
        const responseHtml = document.createElement('div');
        responseHtml.className = 'ai-response';
        responseHtml.innerHTML = `${DOMPurify.sanitize(formatMarkdown(data.answer))}`;
        messagesContainer.appendChild(responseHtml);

        // Update history
        chatHistory.push({ role: "user", content: question });
        chatHistory.push({ role: "assistant", content: data.answer });

        // Sliding window: trim oldest entries if over pair limit
        if (chatHistory.length > MAX_HISTORY_PAIRS * 2) {
          chatHistory = chatHistory.slice(-MAX_HISTORY_PAIRS * 2);
        }

        // Character budget check against tokenLimits.chatHistory
        const charBudget = tokenLimits.chatHistory;
        let totalChars = chatHistory.reduce((sum, msg) => sum + msg.content.length, 0);
        while (totalChars > charBudget && chatHistory.length > 2) {
          // Remove oldest pair (2 messages)
          chatHistory.splice(0, 2);
          totalChars = chatHistory.reduce((sum, msg) => sum + msg.content.length, 0);
        }

        // Update sidebar order immediately
        const pdfList = document.getElementById('pdfList');
        if (pdfList) {
          const items = Array.from(pdfList.children);
          const currentItem = items.find(item => {
            const link = item.querySelector('a');
            return link && link.getAttribute('href') === `/chat/${sessionId}`;
          });
          
          if (currentItem && items.length > 1) {
            // Move current item to top
            pdfList.insertBefore(currentItem, pdfList.firstChild);
          }
        }

        // Format code blocks and scroll
        requestAnimationFrame(() => {
          if (typeof Prism !== 'undefined') {
            Prism.highlightAll();
          }
          scrollToBottom();
        });

      } catch (err) {
        console.error("[Frontend] Error:", err);
        const errorHtml = document.createElement('div');
        errorHtml.className = 'ai-response text-danger';
        errorHtml.innerHTML = `<strong>Error:</strong> ${err.message}`;
        messagesContainer.appendChild(errorHtml);
        scrollToBottom();
      }
    }

    // Initialize DOMPurify and Markdown

    /* Initialize DOMPurify with specific config */
    DOMPurify.setConfig({
      ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li'],
      ALLOWED_ATTR: ['href', 'class']
    });

    /* Initialize marked options */
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false
    });

    function formatMarkdown(text) {
      if (!text) return '';
      
      // First, wrap code blocks with proper classes
      text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre class="code-block"><code class="language-${lang || 'plaintext'}">${code.trim()}</code></pre>`;
      });
      
      // Handle inline code
      text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
      
      // Parse markdown
      const formattedText = marked.parse(text);
      
      // Sanitize and return
      return DOMPurify.sanitize(formattedText);
    }
